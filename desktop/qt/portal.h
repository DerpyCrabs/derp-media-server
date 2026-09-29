#pragma once
#include "client.h"
#include <QDBusArgument>
#include <QDBusMessage>
#include <QDBusServiceWatcher>
#include <QDBusVirtualObject>

struct Rule {
    uint type = 0;
    QString value;
};
struct Filter {
    QString name;
    QList<Rule> rules;
};
struct Pair {
    QString id, value;
};
struct Choice {
    QString id, label;
    QList<Pair> options;
    QString selected;
};
Q_DECLARE_METATYPE(Rule)
Q_DECLARE_METATYPE(Filter)
Q_DECLARE_METATYPE(Pair)
Q_DECLARE_METATYPE(Choice)
QDBusArgument &operator<<(QDBusArgument &, const Rule &);
const QDBusArgument &operator>>(const QDBusArgument &, Rule &);
QDBusArgument &operator<<(QDBusArgument &, const Filter &);
const QDBusArgument &operator>>(const QDBusArgument &, Filter &);
QDBusArgument &operator<<(QDBusArgument &, const Pair &);
const QDBusArgument &operator>>(const QDBusArgument &, Pair &);
QDBusArgument &operator<<(QDBusArgument &, const Choice &);
const QDBusArgument &operator>>(const QDBusArgument &, Choice &);

class Portal : public QDBusVirtualObject {
    Q_OBJECT
  public:
    explicit Portal(Client *client);
    QString introspect(const QString &path) const override;
    bool handleMessage(const QDBusMessage &message, const QDBusConnection &connection) override;

  private:
    Client *client;
    QDBusServiceWatcher *watcher;
    QHash<QString, QPointer<ClientWindow>> requests;
    QHash<QString, QString> owners;
};
