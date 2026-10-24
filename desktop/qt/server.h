#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QStringList>

class Server {
  public:
    QString origin;
    explicit Server(QString origin) : origin(std::move(origin)) {}
    QJsonObject get(const QString &route) const;
    QJsonObject request(const QString &route, const QJsonObject &body) const;
    QJsonObject resolve(const QString &path, bool absolute = false) const;
    QString savePath(const QString &directory, const QString &name) const;
};
