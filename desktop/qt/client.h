#pragma once
#include "server.h"
#include <QApplication>
#include <QJsonArray>
#include <QPointer>
#include <QSet>
#include <QWebEngineProfile>
#include <QWebEngineView>
#include <functional>

class Client;
class Bridge;
class ClientWindow : public QWebEngineView {
    Q_OBJECT
  public:
    ClientWindow(Client *client, QJsonObject target, QJsonObject picker = {}, QString parentHandle = {},
                 QString title = {});
    Bridge *bridge;
    QJsonObject target, picker;
    QStringList dropPaths;
    QString parentHandle;
    void showTarget();
    bool ready = false, approvedClose = false, closing = false, targetPending = false;
    std::function<void(uint, QJsonObject)> pickerFinished;
    void finishPicker(uint code, const QJsonObject &selection = {});

  protected:
    void closeEvent(QCloseEvent *event) override;
    bool eventFilter(QObject *object, QEvent *event) override;
};
class Bridge : public QObject {
    Q_OBJECT
  public:
    Bridge(Client *client, ClientWindow *window);
    Client *client;
    ClientWindow *window;
    QString pickId;
  public slots:
    void call(const QString &id, const QString &method, const QJsonArray &args);
  signals:
    void reply(QString id, QJsonObject result);
    void event(QString name, QJsonObject value);
};
class Client : public QObject {
    Q_OBJECT
  public:
    explicit Client(QString origin);
    Server server;
    QWebEngineProfile *profile;
    QSet<ClientWindow *> windows;
    QPointer<ClientWindow> spare;
    void openTarget(const QJsonObject &target);
    void openPaths(const QStringList &paths);
    void handleArguments(const QStringList &args, const QString &cwd);
    void prepareSpare();
    void quit();
    void error(const QString &message);
};
void background(QObject *context, std::function<QJsonObject()> work, std::function<void(QJsonObject)> done);
QStringList jsonStrings(const QJsonArray &array);
