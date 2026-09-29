#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QStringList>

class Server {
  public:
    QString origin;
    explicit Server(QString origin) : origin(std::move(origin)) {}
    QJsonObject request(const QString &route, const QJsonObject &body) const;
    QJsonObject resolve(const QString &path, bool absolute = false) const;
    int importFiles(const QStringList &sources, const QString &destination) const;
    QString savePath(const QString &directory, const QString &name) const;
};
