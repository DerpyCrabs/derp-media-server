#include "server.h"
#include <QDir>
#include <QEventLoop>
#include <QFile>
#include <QFileInfo>
#include <QHttpMultiPart>
#include <QJsonDocument>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <functional>
#include <stdexcept>

static void fail(const QString &error) { throw std::runtime_error(error.toStdString()); }
static QJsonObject response(QNetworkReply *reply) {
    QEventLoop loop;
    QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    if (!reply->isFinished())
        loop.exec();
    const auto object = QJsonDocument::fromJson(reply->readAll()).object();
    if (reply->error() != QNetworkReply::NoError)
        fail(object.value("error").toString(reply->errorString()));
    return object;
}
QJsonObject Server::request(const QString &route, const QJsonObject &body) const {
    QNetworkAccessManager manager;
    QNetworkRequest request(QUrl(origin + route));
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
    request.setTransferTimeout(30000);
    auto *reply = manager.post(request, QJsonDocument(body).toJson(QJsonDocument::Compact));
    return response(reply);
}
QJsonObject Server::resolve(const QString &path, bool absolute) const {
    return request("/api/desktop/resolve", {{"path", path}, {"absolute", absolute}});
}
QString Server::savePath(const QString &directory, const QString &name) const {
    if (name.isEmpty() || name == "." || name == ".." || name.contains('/') || name.contains('\\') ||
        name.contains(QChar::Null))
        fail("Enter a filename without directory separators");
    const auto folder = resolve(directory);
    if (!folder.value("isDirectory").toBool())
        fail("Choose a destination folder");
    if (!folder.value("editable").toBool())
        fail("The destination is not in an editable folder");
    const QString full = QDir(folder.value("absolutePath").toString()).filePath(name);
    const QFileInfo info(full);
    if (info.isSymLink())
        fail("Cannot save through a symbolic link");
    if (info.exists()) {
        const auto existing = resolve(full, true);
        if (existing.value("isDirectory").toBool())
            fail("A directory already has this name");
    }
    if (!QFileInfo(folder.value("absolutePath").toString()).isWritable())
        fail("The folder is not writable");
    return full;
}
int Server::importFiles(const QStringList &sources, const QString &destination) const {
    const auto target = resolve(destination);
    if (!target.value("isDirectory").toBool())
        fail("Choose a destination folder");
    const auto targetReal = QFileInfo(target.value("absolutePath").toString()).canonicalFilePath();
    int count = 0;
    std::function<void(QString, QString)> visit = [&](QString source, QString logical) {
        QFileInfo info(source);
        if (info.isSymLink())
            fail("Symbolic links cannot be imported: " + source);
        if (info.fileName().contains('\\'))
            fail("Unsupported filename");
        if (info.isDir()) {
            request("/api/files/create", {{"type", "folder"}, {"path", logical}});
            for (const auto &child :
                 QDir(source).entryInfoList(QDir::AllEntries | QDir::NoDotAndDotDot | QDir::Hidden | QDir::System))
                visit(child.absoluteFilePath(), logical + '/' + child.fileName());
        } else if (info.isFile()) {
            QNetworkAccessManager manager;
            QNetworkRequest request(QUrl(origin + "/api/files/upload?create_only=true"));
            request.setTransferTimeout(30000);
            request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
            QHttpMultiPart form(QHttpMultiPart::FormDataType);
            QHttpPart dir;
            dir.setHeader(QNetworkRequest::ContentDispositionHeader, "form-data; name=\"targetDir\"");
            dir.setBody((logical.contains('/') ? logical.section('/', 0, -2) : QString()).toUtf8());
            form.append(dir);
            QFile file(source);
            if (!file.open(QIODevice::ReadOnly))
                fail(file.errorString());
            QHttpPart item;
            QString name = info.fileName();
            name.replace('"', "%22");
            name.replace('\r', "%0D");
            name.replace('\n', "%0A");
            item.setHeader(QNetworkRequest::ContentDispositionHeader,
                           "form-data; name=\"files\"; filename=\"" + name + "\"");
            item.setBodyDevice(&file);
            form.append(item);
            response(manager.post(request, &form));
            ++count;
        } else
            fail("Only regular files and directories can be imported");
    };
    for (const auto &source : sources) {
        const auto sourceReal = QFileInfo(source).canonicalFilePath();
        if (sourceReal.isEmpty())
            fail("Source does not exist");
        if (targetReal == sourceReal || targetReal.startsWith(sourceReal + '/'))
            fail("Cannot copy a folder into itself");
        visit(source,
              destination.isEmpty() ? QFileInfo(source).fileName() : destination + '/' + QFileInfo(source).fileName());
    }
    return count;
}
