#pragma once
#include "server.h"
#include <QMap>
#include <QMutex>
#include <QObject>
#include <atomic>
#include <memory>

struct NativeJob {
    QMutex mutex;
    QJsonObject progress;
    std::atomic_bool cancelled{false};
    QString decision;
    bool applyAll = false;
};
class NativeJobs : public QObject {
  public:
    NativeJobs(Server server, QObject *parent) : QObject(parent), server(std::move(server)) {}
    void start(const QStringList &sources, const QString &destination, bool moving);
    QJsonObject snapshot() const;
    void cancel(const QString &id);
    void decide(const QString &id, const QString &choice, bool all);
    void cancelAll();
    bool active() const;

  private:
    Server server;
    QMap<QString, std::shared_ptr<NativeJob>> jobs;
};
