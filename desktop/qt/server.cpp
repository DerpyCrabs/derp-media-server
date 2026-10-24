#include "server.h"
#include <QDir>
#include <QEventLoop>
#include <QFile>
#include <QFileInfo>
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
QJsonObject Server::get(const QString &route) const {
    QNetworkAccessManager manager;
    QNetworkRequest request(QUrl(origin + route));
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
    request.setTransferTimeout(5000);
    return response(manager.get(request));
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
