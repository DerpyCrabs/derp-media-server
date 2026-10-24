#include "native-jobs.h"
#include "client.h"
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QThread>
#include <QUuid>
#include <stdexcept>

static void fail(const QString &message) { throw std::runtime_error(message.toStdString()); }
static void check(const std::shared_ptr<NativeJob> &job) {
    if (job->cancelled)
        fail("Cancelled");
}
static void update(const std::shared_ptr<NativeJob> &job, const QJsonObject &fields) {
    QMutexLocker lock(&job->mutex);
    for (auto i = fields.begin(); i != fields.end(); ++i)
        job->progress.insert(i.key(), i.value());
}
static void error(const std::shared_ptr<NativeJob> &job, const QString &path, const QString &message) {
    QMutexLocker lock(&job->mutex);
    auto errors = job->progress.value("errors").toArray();
    errors.append(QJsonObject{{"path", path}, {"message", message}});
    job->progress.insert("errors", errors);
}
static void copy(const QString &source, const QString &target, const std::shared_ptr<NativeJob> &job) {
    check(job);
    QFileInfo info(source);
    if (info.isSymLink())
        fail("Symbolic links cannot be imported: " + source);
    if (info.isDir()) {
        if (!QDir().mkdir(target))
            fail("Could not create staging folder");
        for (const auto &entry :
             QDir(source).entryInfoList(QDir::AllEntries | QDir::NoDotAndDotDot | QDir::Hidden | QDir::System))
            copy(entry.absoluteFilePath(), QDir(target).filePath(entry.fileName()), job);
    } else if (info.isFile()) {
        QFile input(source), output(target);
        if (!input.open(QIODevice::ReadOnly) || !output.open(QIODevice::WriteOnly | QIODevice::NewOnly))
            fail("Could not open file: " + source);
        while (!input.atEnd()) {
            check(job);
            auto bytes = input.read(256 * 1024);
            if (bytes.isEmpty() && input.error() != QFileDevice::NoError)
                fail(input.errorString());
            if (output.write(bytes) != bytes.size())
                fail(output.errorString());
            QMutexLocker lock(&job->mutex);
            job->progress.insert("bytes", job->progress.value("bytes").toDouble() + bytes.size());
        }
        if (!output.flush())
            fail(output.errorString());
        output.setPermissions(info.permissions());
    } else
        fail("Only regular files and directories can be imported: " + source);
}
static QJsonArray fingerprint(const QString &source) {
    QFileInfo info(source);
    if (info.isSymLink() || !info.exists())
        fail("Source changed during transfer: " + source);
    QJsonArray result{source, info.size(), info.lastModified().toMSecsSinceEpoch()};
    if (info.isDir())
        for (const auto &entry : QDir(source).entryInfoList(
                 QDir::AllEntries | QDir::NoDotAndDotDot | QDir::Hidden | QDir::System, QDir::Name))
            result.append(fingerprint(entry.absoluteFilePath()));
    return result;
}
static void run(const Server &server, const std::shared_ptr<NativeJob> &job, const QStringList &sources,
                const QString &destination, bool moving) {
    QString stagingFull, serverId;
    bool serverFinished = false;
    try {
        update(job, {{"status", "running"}});
        const auto target = server.resolve(destination);
        if (!target.value("editable").toBool() || !target.value("isDirectory").toBool())
            fail("Choose an editable destination folder");
        const auto directory = QFileInfo(target.value("absolutePath").toString()).canonicalFilePath();
        const auto stageName = ".derp-import-" + QUuid::createUuid().toString(QUuid::WithoutBraces);
        const auto staging = destination.isEmpty() ? stageName : destination + '/' + stageName;
        stagingFull = QDir(directory).filePath(stageName);
        if (!QDir().mkdir(stagingFull))
            fail("Could not create staging folder");
        QJsonArray paths;
        QMap<QString, QJsonArray> originals;
        int index = 0;
        for (const auto &source : sources) {
            check(job);
            update(job, {{"current", source}});
            try {
                QFileInfo info(source);
                const auto real = info.canonicalFilePath();
                if (real.isEmpty() || directory == real || directory.startsWith(real + '/'))
                    fail("Cannot import a folder into itself");
                if (info.fileName().contains('\\') || info.fileName().startsWith(".derp-"))
                    fail("Unsupported filename");
                const auto signature = fingerprint(source);
                const auto subdirectory = QString::number(index++);
                const auto parent = QDir(stagingFull).filePath(subdirectory);
                if (!QDir().mkdir(parent))
                    fail("Could not create staging folder");
                copy(source, QDir(parent).filePath(info.fileName()), job);
                if (fingerprint(source) != signature)
                    fail("Source changed while copying; original retained");
                paths.append(staging + '/' + subdirectory + '/' + info.fileName());
                originals.insert(source, signature);
            } catch (const std::exception &e) {
                check(job);
                error(job, source, QString::fromUtf8(e.what()));
            }
        }
        check(job);
        if (!paths.isEmpty()) {
            const auto created = server.request(
                "/api/file-jobs", {{"operation", "move"}, {"paths", paths}, {"destination", destination}});
            serverId = created.value("id").toString();
            update(job, {{"serverJob", serverId}});
            bool cancelled = false;
            for (;;) {
                if (job->cancelled && !cancelled) {
                    server.request("/api/file-jobs/" + serverId + "/cancel", {});
                    cancelled = true;
                }
                const auto progress = server.get("/api/file-jobs/" + serverId);
                const auto status = progress.value("status").toString();
                update(job, {{"status", (status == "completed" || status == "failed" || status == "cancelled")
                                            ? QString("running")
                                            : status},
                             {"completed", progress.value("completed")},
                             {"skipped", progress.value("skipped")},
                             {"current", progress.value("current")},
                             {"conflict", progress.value("conflict")}});
                QString decision;
                bool all;
                {
                    QMutexLocker lock(&job->mutex);
                    decision = std::move(job->decision);
                    job->decision.clear();
                    all = job->applyAll;
                }
                if (status == "conflict" && !decision.isEmpty())
                    server.request("/api/file-jobs/" + serverId + "/conflict", {{"choice", decision}, {"all", all}});
                if (status == "completed" || status == "failed" || status == "cancelled") {
                    serverFinished = true;
                    if (status == "cancelled")
                        job->cancelled = true;
                    for (const auto &entry : progress.value("errors").toArray())
                        error(job, entry.toObject().value("path").toString(),
                              entry.toObject().value("message").toString());
                    if (moving && status == "completed" && progress.value("skipped").toInt() == 0) {
                        for (auto original = originals.begin(); original != originals.end(); ++original) {
                            try {
                                check(job);
                                if (fingerprint(original.key()) != original.value())
                                    fail("Copied, but source changed; original retained");
                                if (!(QFileInfo(original.key()).isDir() ? QDir(original.key()).removeRecursively()
                                                                        : QFile::remove(original.key())))
                                    fail("Copied, but could not remove original");
                            } catch (const std::exception &e) {
                                error(job, original.key(), QString::fromUtf8(e.what()));
                            }
                        }
                    } else if (moving)
                        error(job, "",
                              "Transfer incomplete or skipped items; original files were "
                              "retained.");
                    break;
                }
                QThread::msleep(100);
            }
        }
    } catch (const std::exception &e) {
        error(job, "", QString::fromUtf8(e.what()));
        if (!serverId.isEmpty() && !serverFinished)
            error(job, "",
                  "Server operation may still be active. Originals and staging were "
                  "retained; inspect server operations after reconnecting.");
    }
    if (!stagingFull.isEmpty() && (serverId.isEmpty() || serverFinished))
        QDir(stagingFull).removeRecursively();
    QMutexLocker lock(&job->mutex);
    job->progress.insert("conflict", QJsonValue::Null);
    job->progress.insert("status", job->cancelled                                      ? "cancelled"
                                   : job->progress.value("errors").toArray().isEmpty() ? "completed"
                                                                                       : "failed");
}
void NativeJobs::start(const QStringList &sources, const QString &destination, bool moving) {
    if (jobs.size() >= 100)
        for (auto i = jobs.begin(); i != jobs.end();) {
            QMutexLocker lock(&i.value()->mutex);
            const auto status = i.value()->progress.value("status").toString();
            if (status == "completed" || status == "failed" || status == "cancelled") {
                lock.unlock();
                i = jobs.erase(i);
            } else
                ++i;
        }
    if (jobs.size() >= 100)
        fail("Too many native operations");
    const auto id = "native-" + QUuid::createUuid().toString(QUuid::WithoutBraces);
    auto job = std::make_shared<NativeJob>();
    job->progress = {{"id", id},
                     {"operation", moving ? "move" : "copy"},
                     {"status", "queued"},
                     {"total", sources.size()},
                     {"completed", 0},
                     {"skipped", 0},
                     {"bytes", 0},
                     {"current", ""},
                     {"conflict", QJsonValue::Null},
                     {"errors", QJsonArray{}}};
    jobs.insert(id, job);
    const auto service = server;
    background(
        this,
        [service, job, sources, destination, moving] {
            run(service, job, sources, destination, moving);
            return QJsonObject{};
        },
        [](QJsonObject) {});
}
QJsonObject NativeJobs::snapshot() const {
    QJsonArray result, managed;
    for (const auto &job : jobs) {
        QMutexLocker lock(&job->mutex);
        result.append(job->progress);
        if (job->progress.contains("serverJob") && !job->progress.value("status").toString().contains("failed"))
            managed.append(job->progress.value("serverJob"));
    }
    return {{"jobs", result}, {"managedIds", managed}};
}
void NativeJobs::cancel(const QString &id) {
    if (jobs.contains(id))
        jobs[id]->cancelled = true;
}
void NativeJobs::decide(const QString &id, const QString &choice, bool all) {
    if (!jobs.contains(id) || (choice != "skip" && choice != "replace" && choice != "keepBoth"))
        return;
    QMutexLocker lock(&jobs[id]->mutex);
    jobs[id]->decision = choice;
    jobs[id]->applyAll = all;
}
void NativeJobs::cancelAll() {
    for (const auto &job : jobs)
        job->cancelled = true;
}
bool NativeJobs::active() const {
    for (const auto &job : jobs) {
        QMutexLocker lock(&job->mutex);
        const auto status = job->progress.value("status").toString();
        if (status == "queued" || status == "running" || status == "conflict")
            return true;
    }
    return false;
}
