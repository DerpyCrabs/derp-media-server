#include "portal.h"
#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QDBusMetaType>
#include <QDBusObjectPath>
#include <QDBusServiceWatcher>
#include <QDir>
#include <QFileInfo>
#include <QMimeDatabase>
#include <QRegularExpression>

QDBusArgument &operator<<(QDBusArgument &a, const Rule &v) {
    a.beginStructure();
    a << v.type << v.value;
    a.endStructure();
    return a;
}
const QDBusArgument &operator>>(const QDBusArgument &a, Rule &v) {
    a.beginStructure();
    a >> v.type >> v.value;
    a.endStructure();
    return a;
}
QDBusArgument &operator<<(QDBusArgument &a, const Filter &v) {
    a.beginStructure();
    a << v.name << v.rules;
    a.endStructure();
    return a;
}
const QDBusArgument &operator>>(const QDBusArgument &a, Filter &v) {
    a.beginStructure();
    a >> v.name >> v.rules;
    a.endStructure();
    return a;
}
QDBusArgument &operator<<(QDBusArgument &a, const Pair &v) {
    a.beginStructure();
    a << v.id << v.value;
    a.endStructure();
    return a;
}
const QDBusArgument &operator>>(const QDBusArgument &a, Pair &v) {
    a.beginStructure();
    a >> v.id >> v.value;
    a.endStructure();
    return a;
}
QDBusArgument &operator<<(QDBusArgument &a, const Choice &v) {
    a.beginStructure();
    a << v.id << v.label << v.options << v.selected;
    a.endStructure();
    return a;
}
const QDBusArgument &operator>>(const QDBusArgument &a, Choice &v) {
    a.beginStructure();
    a >> v.id >> v.label >> v.options >> v.selected;
    a.endStructure();
    return a;
}
static QString bytesPath(const QVariant &value) {
    QByteArray bytes = qdbus_cast<QByteArray>(value);
    if (bytes.endsWith('\0'))
        bytes.chop(1);
    return QFile::decodeName(bytes);
}
static bool matches(const QString &path, const Filter &filter) {
    if (filter.rules.isEmpty())
        return true;
    for (const auto &rule : filter.rules) {
        if (rule.type == 0 && QRegularExpression(QRegularExpression::wildcardToRegularExpression(rule.value))
                                  .match(QFileInfo(path).fileName())
                                  .hasMatch())
            return true;
        if (rule.type == 1) {
            const auto mime = QMimeDatabase().mimeTypeForFile(path);
            if (rule.value.endsWith("/*") ? mime.name().startsWith(rule.value.chopped(1)) : mime.inherits(rule.value))
                return true;
        }
    }
    return false;
}
Portal::Portal(Client *client) : QDBusVirtualObject(client), client(client) {
    qDBusRegisterMetaType<Rule>();
    qDBusRegisterMetaType<QList<Rule>>();
    qDBusRegisterMetaType<Filter>();
    qDBusRegisterMetaType<QList<Filter>>();
    qDBusRegisterMetaType<Pair>();
    qDBusRegisterMetaType<QList<Pair>>();
    qDBusRegisterMetaType<Choice>();
    qDBusRegisterMetaType<QList<Choice>>();
    qDBusRegisterMetaType<QList<QByteArray>>();
    watcher = new QDBusServiceWatcher(this);
    watcher->setConnection(QDBusConnection::sessionBus());
    watcher->setWatchMode(QDBusServiceWatcher::WatchForUnregistration);
    connect(watcher, &QDBusServiceWatcher::serviceUnregistered, this, [this](const QString &owner) {
        const auto paths = owners.keys(owner);
        for (const auto &path : paths)
            if (requests.value(path))
                requests.value(path)->close();
    });
}
QString Portal::introspect(const QString &path) const {
    if (path != "/org/freedesktop/portal/desktop")
        return "<interface name=\"org.freedesktop.impl.portal.Request\"><method name=\"Close\"/></interface>";
    QString xml = "<interface name=\"org.freedesktop.impl.portal.FileChooser\"><property name=\"version\" type=\"u\" "
                  "access=\"read\"/>";
    for (const auto &name : {"OpenFile", "SaveFile", "SaveFiles"})
        xml += QString("<method name=\"%1\"><arg name=\"handle\" type=\"o\" direction=\"in\"/><arg name=\"app_id\" "
                       "type=\"s\" direction=\"in\"/><arg name=\"parent_window\" type=\"s\" direction=\"in\"/><arg "
                       "name=\"title\" type=\"s\" direction=\"in\"/><arg name=\"options\" type=\"a{sv}\" "
                       "direction=\"in\"/><arg name=\"response\" type=\"u\" direction=\"out\"/><arg name=\"results\" "
                       "type=\"a{sv}\" direction=\"out\"/></method>")
                   .arg(name);
    return xml + "</interface>";
}
bool Portal::handleMessage(const QDBusMessage &message, const QDBusConnection &connection) {
    if (message.interface() == "org.freedesktop.DBus.Properties") {
        const auto args = message.arguments();
        if (message.path() != "/org/freedesktop/portal/desktop" || args.isEmpty() ||
            args[0].toString() != "org.freedesktop.impl.portal.FileChooser") {
            connection.send(message.createErrorReply(QDBusError::UnknownInterface, "Unknown portal interface"));
        } else if (message.member() == "Get" && args.size() == 2 && args[1].toString() == "version") {
            connection.send(message.createReply(QVariant::fromValue(QDBusVariant(uint(4)))));
        } else if (message.member() == "GetAll" && args.size() == 1) {
            connection.send(message.createReply(QVariantMap{{"version", uint(4)}}));
        } else {
            connection.send(message.createErrorReply(QDBusError::InvalidArgs, "Unknown property or method"));
        }
        return true;
    }
    if (message.interface() == "org.freedesktop.impl.portal.Request" && message.member() == "Close") {
        if (owners.value(message.path()) != message.service()) {
            connection.send(message.createErrorReply(QDBusError::AccessDenied, "Not the request owner"));
            return true;
        }
        if (requests.value(message.path()))
            requests.value(message.path())->close();
        connection.send(message.createReply());
        return true;
    }
    if (message.interface() != "org.freedesktop.impl.portal.FileChooser" ||
        !QStringList{"OpenFile", "SaveFile", "SaveFiles"}.contains(message.member()))
        return false;
    const auto args = message.arguments();
    if (args.size() != 5 || message.signature() != "osssa{sv}") {
        connection.send(message.createErrorReply(QDBusError::InvalidArgs, "Expected five arguments"));
        return true;
    }
    const QString handle = qdbus_cast<QDBusObjectPath>(args[0]).path();
    if (requests.contains(handle) || !handle.startsWith("/org/freedesktop/portal/desktop/request/")) {
        connection.send(message.createErrorReply(QDBusError::InvalidArgs, "Invalid request handle"));
        return true;
    }
    const auto options = qdbus_cast<QVariantMap>(args[4]);
    const auto method = message.member();
    auto filters = qdbus_cast<QList<Filter>>(options.value("filters"));
    const auto currentFilter = qdbus_cast<Filter>(options.value("current_filter"));
    if (filters.isEmpty() && !currentFilter.rules.isEmpty())
        filters.append(currentFilter);
    const auto choices = qdbus_cast<QList<Choice>>(options.value("choices"));
    QJsonArray filterJson, choiceJson;
    int current = 0;
    for (qsizetype i = 0; i < filters.size(); ++i) {
        QJsonArray rules;
        for (const auto &rule : filters[i].rules) {
            QJsonArray patterns;
            if (rule.type == 1) {
                if (rule.value.endsWith("/*")) {
                    for (const auto &mime : QMimeDatabase().allMimeTypes())
                        if (mime.name().startsWith(rule.value.chopped(1)))
                            for (const auto &glob : mime.globPatterns())
                                patterns.append(glob);
                } else
                    for (const auto &glob : QMimeDatabase().mimeTypeForName(rule.value).globPatterns())
                        patterns.append(glob);
            } else
                patterns.append(rule.value);
            rules.append(QJsonObject{{"type", int(rule.type)}, {"value", rule.value}, {"patterns", patterns}});
        }
        filterJson.append(QJsonObject{{"name", filters[i].name}, {"rules", rules}});
        if (filters[i].name == currentFilter.name)
            current = int(i);
    }
    for (const auto &choice : choices) {
        QJsonArray values;
        for (const auto &value : choice.options)
            values.append(QJsonObject{{"id", value.id}, {"label", value.value}});
        choiceJson.append(QJsonObject{
            {"id", choice.id}, {"label", choice.label}, {"options", values}, {"selected", choice.selected}});
    }
    QString name = options.value("current_name").toString();
    QString initial = bytesPath(options.value("current_folder"));
    const auto currentFile = bytesPath(options.value("current_file"));
    if (!currentFile.isEmpty()) {
        initial = QFileInfo(currentFile).absolutePath();
        name = QFileInfo(currentFile).fileName();
    }
    QJsonObject picker{{"mode", method},
                       {"directory", options.value("directory").toBool() || method == "SaveFiles"},
                       {"multiple", options.value("multiple").toBool() && method == "OpenFile"},
                       {"modal", options.value("modal", true).toBool()},
                       {"name", name},
                       {"filters", filterJson},
                       {"filter", current},
                       {"choices", choiceJson},
                       {"acceptLabel", options.value("accept_label").toString().remove('_')}};
    auto *window = new ClientWindow(client, {{"path", ""}, {"isDirectory", true}, {"mediaType", "folder"}}, picker,
                                    args[2].toString(), args[3].toString());
    client->windows.insert(window);
    connect(window, &QObject::destroyed, client, [this, window] { client->windows.remove(window); });
    requests.insert(handle, window);
    owners.insert(handle, message.service());
    watcher->addWatchedService(message.service());
    const auto server = client->server;
    if (!initial.isEmpty()) {
        window->targetPending = true;
        background(
            window, [server, initial] { return server.resolve(initial, true); },
            [window](QJsonObject result) {
                if (!result.contains("error") && result.value("value").toObject().value("isDirectory").toBool())
                    window->target = result.value("value").toObject();
                window->targetPending = false;
                if (window->ready) {
                    emit window->bridge->event("open", window->target);
                    window->showTarget();
                }
            });
    }
    QPointer<ClientWindow> guarded(window);
    window->pickerFinished = [this, guarded, handle, message, connection, server, method, filters, choices,
                              options](uint code, QJsonObject selection) {
        if (!guarded)
            return;
        auto finish = [this, guarded, handle, message, connection](uint response, QVariantMap results) {
            requests.remove(handle);
            const auto owner = owners.take(handle);
            if (!owners.values().contains(owner))
                watcher->removeWatchedService(owner);
            connection.send(message.createReply(QVariantList{response, results}));
            if (guarded) {
                guarded->pickerFinished = {};
                guarded->approvedClose = true;
                guarded->close();
            }
        };
        if (code != 0) {
            finish(code, {});
            return;
        }
        if (guarded->property("validating").toBool())
            return;
        guarded->setProperty("validating", true);
        background(
            guarded,
            [server, method, filters, options, selection]() -> QJsonObject {
                QStringList paths, existing;
                const bool directory = options.value("directory").toBool();
                if (method == "OpenFile") {
                    const auto selected = jsonStrings(selection.value("paths").toArray());
                    if (selected.isEmpty() || (!options.value("multiple").toBool() && selected.size() != 1))
                        throw std::runtime_error("Select the requested number of items");
                    for (const auto &path : selected) {
                        const auto file = server.resolve(path);
                        if (file.value("isDirectory").toBool() != directory)
                            throw std::runtime_error("Select the requested file or folder type");
                        const auto absolute = file.value("absolutePath").toString();
                        const int filter = selection.value("filter").toInt();
                        if (!directory && filter >= 0 && filter < filters.size() && !matches(absolute, filters[filter]))
                            throw std::runtime_error("The selected file does not match the file type filter");
                        paths << absolute;
                    }
                } else if (method == "SaveFile") {
                    const auto path =
                        server.savePath(selection.value("directory").toString(), selection.value("name").toString());
                    paths << path;
                    if (QFileInfo::exists(path))
                        existing << path;
                } else {
                    const auto names = qdbus_cast<QList<QByteArray>>(options.value("files"));
                    if (names.isEmpty())
                        throw std::runtime_error("No filenames were supplied");
                    QSet<QString> reserved;
                    for (auto bytes : names) {
                        if (bytes.endsWith('\0'))
                            bytes.chop(1);
                        const auto name = QFile::decodeName(bytes);
                        QString path = server.savePath(selection.value("directory").toString(), name);
                        int suffix = 1;
                        while (QFileInfo::exists(path) || reserved.contains(path)) {
                            const QFileInfo info(name);
                            auto unique = info.completeBaseName() + QString(" (%1)").arg(suffix++) +
                                          (info.suffix().isEmpty() ? "" : '.' + info.suffix());
                            path = server.savePath(selection.value("directory").toString(), unique);
                        }
                        reserved.insert(path);
                        paths << path;
                    }
                }
                QJsonArray uris;
                for (const auto &path : paths)
                    uris.append(QUrl::fromLocalFile(path).toString(QUrl::FullyEncoded));
                return {{"uris", uris}, {"existing", QJsonArray::fromStringList(existing)}};
            },
            [guarded, selection, filters, choices, finish](QJsonObject response) {
                if (!guarded)
                    return;
                guarded->setProperty("validating", false);
                if (response.contains("error")) {
                    emit guarded->bridge->reply(guarded->bridge->pickId, response);
                    return;
                }
                const auto value = response.value("value").toObject();
                if (!selection.value("overwrite").toBool() && !value.value("existing").toArray().isEmpty()) {
                    emit guarded->bridge->reply(guarded->bridge->pickId,
                                                {{"value", QJsonObject{{"overwrite", value.value("existing")}}}});
                    return;
                }
                QVariantMap results{{"uris", jsonStrings(value.value("uris").toArray())}};
                const int filter = selection.value("filter").toInt();
                if (filter >= 0 && filter < filters.size())
                    results.insert("current_filter", QVariant::fromValue(filters[filter]));
                QList<Pair> selectedChoices;
                for (const auto &choice : choices) {
                    const auto selected =
                        selection.value("choices").toObject().value(choice.id).toString(choice.selected);
                    bool valid = choice.options.isEmpty() ? (selected == "true" || selected == "false") : false;
                    for (const auto &option : choice.options)
                        if (option.id == selected)
                            valid = true;
                    if (!valid) {
                        emit guarded->bridge->reply(guarded->bridge->pickId, {{"error", "Invalid choice"}});
                        return;
                    }
                    selectedChoices.append({choice.id, selected});
                }
                if (!choices.isEmpty())
                    results.insert("choices", QVariant::fromValue(selectedChoices));
                emit guarded->bridge->reply(guarded->bridge->pickId, {{"value", QJsonObject{}}});
                finish(0, results);
            });
    };
    return true;
}
