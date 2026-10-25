#include "client.h"
#include "printing.h"
#include "downloads.h"
#include <QDesktopServices>
#include <QWebEngineNewWindowRequest>
#include <KWindowSystem>
#include <QClipboard>
#include <QCloseEvent>
#include <QDir>
#include <QDrag>
#include <QDropEvent>
#include <QFile>
#include <QFutureWatcher>
#include <QJsonDocument>
#include <QLabel>
#include <QMessageBox>
#include <QMimeData>
#include <QMimeDatabase>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QProcess>
#include <QPushButton>
#include <QSaveFile>
#include <QSettings>
#include <QShortcut>
#include <QStandardPaths>
#include <QStorageInfo>
#include <QTimer>
#include <QUrlQuery>
#include <QVBoxLayout>
#include <QWebChannel>
#include <QWebEngineFullScreenRequest>
#include <QWebEnginePermission>
#include <QWebEngineScript>
#include <QWebEngineScriptCollection>
#include <QWebEngineSettings>
#include <QtConcurrent>

void background(QObject *context, std::function<QJsonObject()> work, std::function<void(QJsonObject)> done) {
    auto *watcher = new QFutureWatcher<QJsonObject>(context);
    QObject::connect(watcher, &QFutureWatcher<QJsonObject>::finished, context, [watcher, done] {
        done(watcher->result());
        watcher->deleteLater();
    });
    watcher->setFuture(QtConcurrent::run([work] {
        try {
            return QJsonObject{{"value", work()}};
        } catch (const std::exception &error) {
            return QJsonObject{{"error", QString::fromUtf8(error.what())}};
        }
    }));
}
QStringList jsonStrings(const QJsonArray &array) {
    QStringList result;
    for (const auto &value : array)
        result << value.toString();
    return result;
}
static QStringList clipboardPaths() {
    QStringList result;
    const auto *mime = QApplication::clipboard()->mimeData();
    if (!mime)
        return result;
    for (const auto &url : mime->urls())
        if (url.isLocalFile() && url.host().isEmpty())
            result << url.toLocalFile();
    if (result.isEmpty()) {
        for (const auto &line : mime->data("x-special/gnome-copied-files").split('\n')) {
            QUrl url(QString::fromUtf8(line));
            if (url.isLocalFile() && url.host().isEmpty())
                result << url.toLocalFile();
        }
    }
    result.removeDuplicates();
    return result;
}
static QString applicationFile(const QString &id) {
    if (!id.endsWith(".desktop") || id.contains('/') || id.contains('\\'))
        throw std::runtime_error("Invalid application identifier");
    const auto path = QStandardPaths::locate(QStandardPaths::ApplicationsLocation, id);
    if (path.isEmpty())
        throw std::runtime_error("Application is no longer installed");
    return path;
}
static QJsonArray applicationsFor(const QString &path) {
    QProcess process;
    process.setProcessEnvironment(QProcessEnvironment::systemEnvironment());
    process.start("gio", {"mime", QMimeDatabase().mimeTypeForFile(path).name()});
    if (!process.waitForFinished(5000) || process.exitCode() != 0)
        throw std::runtime_error("Cannot read registered applications (gio)");
    QJsonArray result;
    QSet<QString> seen;
    for (auto line : QString::fromUtf8(process.readAllStandardOutput()).split('\n')) {
        line = line.trimmed();
        if (!line.endsWith(".desktop") || line.contains(':') || seen.contains(line))
            continue;
        try {
            QSettings desktop(applicationFile(line), QSettings::IniFormat);
            desktop.beginGroup("Desktop Entry");
            if (desktop.value("Hidden", false).toBool() || desktop.value("NoDisplay", false).toBool())
                continue;
            result.append(QJsonObject{{"id", line}, {"name", desktop.value("Name", line).toString()}});
            seen.insert(line);
        } catch (...) {
        }
    }
    return result;
}
class Page : public QWebEnginePage {
  public:
    Page(QWebEngineProfile *profile, QString origin, QObject *parent)
        : QWebEnginePage(profile, parent), origin(std::move(origin)) {
        connect(this, &QWebEnginePage::newWindowRequested, this, [](QWebEngineNewWindowRequest &request) {
            if (request.isUserInitiated()) openExternal(request.requestedUrl());
        });
    }
    static void openExternal(const QUrl &url) {
        if (url.scheme() == "https" || url.scheme() == "http" || url.scheme() == "mailto")
            QDesktopServices::openUrl(url);
    }

  protected:
    bool acceptNavigationRequest(const QUrl &url, NavigationType type, bool main) override {
        if (!main) return true;
        const bool sameOrigin = url.adjusted(QUrl::RemovePath | QUrl::RemoveQuery | QUrl::RemoveFragment).toString() == origin;
        if (sameOrigin && url.path() == "/desktop") return true;
        if (sameOrigin && url.path() == "/api/files/download") return true;
        if (type == NavigationTypeLinkClicked) openExternal(url);
        return false;
    }
    QWebEnginePage *createWindow(WebWindowType) override { return nullptr; }
    void javaScriptConsoleMessage(JavaScriptConsoleMessageLevel level, const QString &message, int line,
                                  const QString &source) override {
        if (level == ErrorMessageLevel)
            qWarning().noquote() << source << line << message;
    }

  private:
    QString origin;
};
ClientWindow::ClientWindow(Client *client, QJsonObject target, QJsonObject picker, QString parentHandle, QString title)
    : client(client), target(std::move(target)), picker(std::move(picker)) {
    setAttribute(Qt::WA_DeleteOnClose);
    if (!this->picker.isEmpty()) {
        setWindowFlag(Qt::Dialog);
        // Native modal hint also identifies parentless portal dialogs to Wayland
        // compositors.
        setWindowModality(this->picker.value("modal").toBool(true) ? Qt::WindowModal : Qt::NonModal);
    }
    resize(1100, 800);
    setMinimumSize(360, 280);
    setWindowTitle(title.isEmpty() ? "Derp Media Server" : title);
    setWindowIcon(QIcon(":/desktop/icon.svg"));
    auto *webpage = new Page(client->profile, client->server.origin, this);
    setPage(webpage);
    webpage->setBackgroundColor(QColor("#09090b"));
    webpage->settings()->setAttribute(QWebEngineSettings::FullScreenSupportEnabled, true);
    webpage->settings()->setAttribute(QWebEngineSettings::PlaybackRequiresUserGesture, false);
    bridge = new Bridge(client, this);
    auto *channel = new QWebChannel(webpage);
    channel->registerObject("desktop", bridge);
    webpage->setWebChannel(channel);
    QFile webchannel(":/qtwebchannel/qwebchannel.js"), script(":/desktop/bridge.js");
    if (!webchannel.open(QIODevice::ReadOnly) || !script.open(QIODevice::ReadOnly))
        qFatal("Missing desktop bridge resources");
    QWebEngineScript injection;
    injection.setName("derp-desktop");
    injection.setInjectionPoint(QWebEngineScript::DocumentCreation);
    injection.setWorldId(QWebEngineScript::MainWorld);
    injection.setRunsOnSubFrames(false);
    injection.setSourceCode(QString::fromUtf8(webchannel.readAll()) + '\n' + QString::fromUtf8(script.readAll()));
    webpage->scripts().insert(injection);
    connect(webpage, &QWebEnginePage::fullScreenRequested, this, [this](QWebEngineFullScreenRequest request) {
        request.accept();
        request.toggleOn() ? showFullScreen() : showNormal();
    });
    connect(webpage, &QWebEnginePage::permissionRequested, this, [](QWebEnginePermission permission) {
        if (permission.permissionType() == QWebEnginePermission::PermissionType::ClipboardReadWrite)
            permission.grant();
        else
            permission.deny();
    });
    connect(webpage, &QWebEnginePage::windowCloseRequested, this, [this] {
        approvedClose = true;
        close();
    });
    connect(webpage, &QWebEnginePage::titleChanged, this, [this](const QString &value) {
        if (this->picker.isEmpty())
            setWindowTitle(value);
    });
    recovery = new QWidget(this);
    recovery->setStyleSheet("background:#18181b;color:#fafafa;padding:8px;");
    auto *recoveryLayout = new QVBoxLayout(recovery);
    auto *message = new QLabel("Connecting to " + client->server.origin, recovery);
    message->setObjectName("connection-message");
    message->setWordWrap(true);
    recoveryLayout->addWidget(message);
    auto *retry = new QPushButton("Retry connection", recovery);
    recoveryLayout->addWidget(retry);
    connect(retry, &QPushButton::clicked, this, [this] {
        if (!ready)
            offline = true;
        checkConnection();
    });
    if (!client->serverService.isEmpty()) {
        auto *start = new QPushButton("Start server", recovery);
        recoveryLayout->addWidget(start);
        connect(start, &QPushButton::clicked, this, [this, client] {
            QProcess::startDetached("systemctl", {"--user", "start", client->serverService});
            QTimer::singleShot(1000, this, &ClientWindow::checkConnection);
        });
    }
    recovery->setGeometry(0, 0, width(), 150);
    recovery->show();
    connect(this, &QWebEngineView::loadFinished, this, [this](bool success) {
        if (!success)
            setRecovery("Cannot load the desktop UI. Check the server, then retry.");
    });
    connect(this, &QWebEngineView::urlChanged, this, [this, client](const QUrl &url) {
        const QUrlQuery query(url);
        if (!this->picker.isEmpty() || query.hasQueryItem("warm"))
            return;
        const bool viewer = query.queryItemValue("mode") == "viewer";
        this->target = {{"path", query.queryItemValue(viewer ? "viewing" : "dir")},
                        {"isDirectory", !viewer || query.queryItemValue("kind") == "folder"},
                        {"mediaType", query.queryItemValue("kind")},
                        {"reader", query.queryItemValue("kind") == "folder"}};
        client->saveSession();
    });
    auto *health = new QTimer(this);
    connect(health, &QTimer::timeout, this, &ClientWindow::checkConnection);
    health->start(3000);
    auto *reopen = new QShortcut(QKeySequence("Ctrl+Shift+T"), this);
    connect(reopen, &QShortcut::activated, client, &Client::reopenClosed);
    auto *shortcut = new QShortcut(QKeySequence("Ctrl+N"), this);
    connect(shortcut, &QShortcut::activated, client,
            [client] { client->openTarget({{"path", ""}, {"isDirectory", true}, {"mediaType", "folder"}}); });
    auto *closeShortcut = new QShortcut(QKeySequence("Ctrl+W"), this);
    connect(closeShortcut, &QShortcut::activated, this, &QWidget::close);
    qApp->installEventFilter(this);
    this->parentHandle = parentHandle;
    load(QUrl(client->server.origin + "/desktop?warm=1"));
    QTimer::singleShot(20000, this, [this] {
        if (!ready)
            setRecovery("Desktop UI did not become ready. Retry when the server is "
                        "available.");
    });
}
void ClientWindow::resizeEvent(QResizeEvent *event) {
    QWebEngineView::resizeEvent(event);
    if (recovery)
        recovery->setGeometry(0, 0, width(), ready ? 150 : height());
}
void ClientWindow::setRecovery(const QString &message) {
    offline = true;
    recovery->findChild<QLabel *>("connection-message")->setText(message);
    recovery->setGeometry(0, 0, width(), ready ? 150 : height());
    recovery->show();
    recovery->raise();
}
void ClientWindow::checkConnection() {
    if (checking)
        return;
    checking = true;
    auto *manager = new QNetworkAccessManager(this);
    QNetworkRequest request(QUrl(client->server.origin + "/api/config"));
    request.setTransferTimeout(2000);
    auto *reply = manager->get(request);
    connect(reply, &QNetworkReply::finished, this, [this, reply, manager] {
        checking = false;
        const bool healthy =
            reply->error() == QNetworkReply::NoError && QJsonDocument::fromJson(reply->readAll()).isObject();
        if (!healthy)
            setRecovery(ready ? "Server disconnected. Keep this window open to "
                                "preserve unsaved work; reconnecting…"
                              : "Server unavailable at " + client->server.origin + ". Reconnecting…");
        else {
            if (offline && !ready)
                load(QUrl(client->server.origin + "/desktop?warm=1"));
            offline = false;
            if (ready && !targetPending)
                recovery->hide();
            if (targetPending && !property("resolving-path").toBool()) {
                setProperty("resolving-path", true);
                const auto server = client->server;
                const auto path = target.value("pendingAbsolute").toString();
                background(
                    this, [server, path] { return server.resolve(path, true); },
                    [this](QJsonObject result) {
                        setProperty("resolving-path", false);
                        if (result.contains("error")) {
                            setRecovery(result.value("error").toString());
                            return;
                        }
                        target = result.value("value").toObject();
                        targetPending = false;
                        if (ready) {
                            emit bridge->event("open", target);
                            recovery->hide();
                        }
                        client->saveSession();
                    });
            }
        }
        manager->deleteLater();
    });
}

void ClientWindow::showTarget() {
    if (parentHandle.startsWith("wayland:")) {
        winId();
        KWindowSystem::setMainWindow(windowHandle(), parentHandle.mid(8));
    }
    show();
}
bool ClientWindow::eventFilter(QObject *object, QEvent *event) {
    auto *widget = qobject_cast<QWidget *>(object);
    if (event->type() == QEvent::Drop && widget && (widget == this || isAncestorOf(widget))) {
        dropPaths.clear();
        for (const auto &url : static_cast<QDropEvent *>(event)->mimeData()->urls())
            if (url.isLocalFile() && url.host().isEmpty())
                dropPaths << url.toLocalFile();
    }
    return QWebEngineView::eventFilter(object, event);
}
void ClientWindow::finishPicker(uint code, const QJsonObject &selection) {
    auto callback = std::move(pickerFinished);
    if (callback)
        callback(code, selection);
    approvedClose = true;
    close();
}
void ClientWindow::closeEvent(QCloseEvent *event) {
    if (pickerFinished) {
        auto callback = std::move(pickerFinished);
        callback(1, {});
    }
    // A never-assigned warm page has no user document or persistence work to
    // flush.
    if (ready && !approvedClose && picker.isEmpty() && !target.isEmpty()) {
        event->ignore();
        if (!closing) {
            closing = true;
            emit bridge->event("before-close", {});
        }
        return;
    }
    if (picker.isEmpty() && !target.isEmpty() && !client->quitting) {
        client->closed.append(target);
        while (client->closed.size() > 20)
            client->closed.removeFirst();
    }
    client->windows.remove(this);
    if (!client->quitting)
        client->saveSession();
    QWebEngineView::closeEvent(event);
}
Bridge::Bridge(Client *client, ClientWindow *window) : QObject(window), client(client), window(window) {}
void Bridge::call(const QString &id, const QString &method, const QJsonArray &args) {
    auto respond = [this, id](QJsonValue value = QJsonValue()) { emit reply(id, {{"value", value}}); };
    if (method == "print-frame") {
        const auto name = args.at(0).toString();
        if (window->printJob || !name.startsWith("derp-print-")) {
            emit reply(id, {{"error", "Another print dialog is open, or the document is unavailable."}});
            return;
        }
        window->printFrameName = name;
        QPointer<Bridge> self(this);
        window->printJob = printDocumentFrame(window->page(), window, name, [self, id](QString error) {
            if (!self) return;
            self->window->printJob = nullptr;
            self->window->printFrameName.clear();
            emit self->reply(id, error.isEmpty() ? QJsonObject{{"value", QJsonValue()}} : QJsonObject{{"error", error}});
        });
        return;
    }
    if (method == "cancel-print") {
        if (window->printFrameName == args.at(0).toString()) cancelDocumentPrint(window->printJob);
        respond();
        return;
    }
    if (method == "native-jobs") {
        respond(client->nativeJobs->snapshot());
        return;
    }
    if (method == "cancel-native-job") {
        client->nativeJobs->cancel(args[0].toString());
        respond();
        return;
    }
    if (method == "decide-native-job") {
        client->nativeJobs->decide(args[0].toString(), args[1].toString(), args[2].toBool());
        respond();
        return;
    }
    if (method == "ready") {
        window->ready = true;
        window->offline = false;
        if (!window->targetPending)
            window->recovery->hide();
        else
            window->checkConnection();
        respond();
        if (!window->picker.isEmpty())
            emit event("picker", window->picker);
        if (!window->target.isEmpty() && !window->targetPending) {
            emit event("open", window->target);
            window->showTarget();
        }
        return;
    }
    if (method == "close") {
        respond();
        window->close();
        return;
    }
    if (method == "close-ready") {
        window->closing = false;
        if (!args.isEmpty() && !args[0].toString().isEmpty()) {
            client->quitting = false;
            client->error(args[0].toString());
        } else
            window->page()->triggerAction(QWebEnginePage::RequestClose);
        respond();
        return;
    }
    if (method == "has-files") {
        respond(!clipboardPaths().isEmpty());
        return;
    }
    if (method == "pick") {
        if (window->picker.isEmpty() || window->property("validating").toBool()) {
            emit reply(id, {{"error", "Picker is unavailable or already validating"}});
            return;
        }
        // Portal validation completes asynchronously and reports errors through
        // this bridge.
        pickId = id;
        if (window->pickerFinished)
            window->pickerFinished(0, args[0].toObject());
        return;
    }
    QStringList sources;
    if (method == "paste")
        sources = clipboardPaths();
    if (method == "import-drop" || method == "open-drop") {
        sources = window->dropPaths;
        window->dropPaths.clear();
    }
    const auto *clipboard = QApplication::clipboard()->mimeData();
    const bool cut = method == "paste" && clipboard &&
                     (clipboard->data("x-special/gnome-copied-files").startsWith("cut\n") ||
                      clipboard->data("application/x-kde-cutselection") == "1");
    const auto server = client->server;
    background(
        this,
        [server, method, args, sources, cut]() -> QJsonObject {
            if (method == "places") {
                QJsonArray places;
                QSet<QString> seen;
                auto add = [&](const QString &name, const QString &path) {
                    if (path.isEmpty() || seen.contains(path))
                        return;
                    try {
                        auto target = server.resolve(path, true);
                        places.append(QJsonObject{{"name", name}, {"path", target.value("path")}});
                        seen.insert(path);
                    } catch (...) {
                    }
                };
                add("Home", QDir::homePath());
                add("Downloads", QStandardPaths::writableLocation(QStandardPaths::DownloadLocation));
                add("Documents", QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation));
                for (const auto &volume : QStorageInfo::mountedVolumes())
                    if (volume.isValid() && volume.isReady())
                        add(volume.displayName().isEmpty() ? volume.rootPath() : volume.displayName(),
                            volume.rootPath());
                return {{"result", places}};
            }
            if (method == "resolve-path") {
                auto target = server.resolve(args[0].toString(), true);
                if (!target.value("isDirectory").toBool())
                    throw std::runtime_error("Choose a folder");
                return {{"result", target.value("path")}};
            }
            if (method == "applications" || method == "open-with" || method == "terminal") {
                const auto path = server.resolve(args[0].toString()).value("absolutePath").toString();
                if (method == "applications")
                    return {{"result", applicationsFor(path)}};
                bool started =
                    method == "terminal"
                        ? QProcess::startDetached("xdg-terminal-exec", {"--dir=" + path})
                        : QProcess::startDetached("gio", {"launch", applicationFile(args[1].toString()), path});
                if (!started)
                    throw std::runtime_error("Could not start the installed application");
                return {};
            }
            if (method == "open") {
                if (args[0].toString().isEmpty())
                    return {{"path", ""}, {"isDirectory", true}, {"mediaType", "folder"}};
                auto target = server.resolve(args[0].toString());
                target["reader"] = args.size() > 1 && args[1].toBool();
                return target;
            }
            if (method == "copy" || method == "cut" || method == "drag" || method == "open-drop") {
                QJsonArray paths, targets;
                const auto values = method == "open-drop" ? sources : jsonStrings(args[0].toArray());
                for (const auto &path : values) {
                    auto target = server.resolve(path, method == "open-drop");
                    paths.append(target.value("absolutePath"));
                    targets.append(target);
                }
                return {{"paths", paths}, {"targets", targets}};
            }
            if (method == "paste" || method == "import-drop") {
                QJsonArray logical;
                bool internal = !sources.isEmpty();
                for (const auto &source : sources) {
                    try {
                        logical.append(server.resolve(source, true).value("path"));
                    } catch (...) {
                        internal = false;
                        break;
                    }
                }
                if (internal) {
                    server.request(
                        "/api/file-jobs",
                        {{"operation", cut ? "move" : "copy"}, {"paths", logical}, {"destination", args[0]}});
                    return {{"count", logical.size()}};
                }
                return {{"nativeImport", true},
                        {"sources", QJsonArray::fromStringList(sources)},
                        {"destination", args[0]},
                        {"cut", cut},
                        {"count", sources.size()}};
            }
            throw std::runtime_error("Unknown desktop operation");
        },
        [this, id, method](QJsonObject result) {
            if (result.contains("error")) {
                emit reply(id, result);
                return;
            }
            const auto value = result.value("value").toObject();
            if (value.value("nativeImport").toBool()) {
                try {
                    client->nativeJobs->start(jsonStrings(value.value("sources").toArray()),
                                              value.value("destination").toString(), value.value("cut").toBool());
                } catch (const std::exception &e) {
                    emit reply(id, {{"error", QString::fromUtf8(e.what())}});
                    return;
                }
            }
            if (method == "open")
                client->openTarget(value);
            if (method == "open-drop")
                for (const auto &target : value.value("targets").toArray())
                    client->openTarget(target.toObject());
            if (method == "copy" || method == "cut" || method == "drag") {
                auto *mime = new QMimeData;
                QList<QUrl> urls;
                for (const auto &path : value.value("paths").toArray())
                    urls << QUrl::fromLocalFile(path.toString());
                mime->setUrls(urls);
                QByteArray copied(method == "cut" ? "cut\n" : "copy\n");
                mime->setData("application/x-kde-cutselection", method == "cut" ? "1" : "0");
                for (const auto &url : urls)
                    copied += url.toEncoded() + '\n';
                mime->setData("x-special/gnome-copied-files", copied);
                if (method == "copy" || method == "cut")
                    QApplication::clipboard()->setMimeData(mime);
                else {
                    auto *drag = new QDrag(window);
                    drag->setMimeData(mime);
                    drag->setPixmap(QIcon(":/desktop/icon.svg").pixmap(32, 32));
                    drag->exec(Qt::CopyAction);
                    drag->deleteLater();
                }
            }
            emit reply(id, {{"value", value.contains("result") ? value.value("result") : value.value("count")}});
        });
}
Client::Client(QString origin) : server(std::move(origin)) {
    nativeJobs = new NativeJobs(server, this);
    const QString configDir =
        qEnvironmentVariable("XDG_CONFIG_HOME", QDir::homePath() + "/.config") + "/derp-media-server";
    QFile config(configDir + "/desktop.json");
    if (config.open(QIODevice::ReadOnly)) {
        auto settings = QJsonDocument::fromJson(config.readAll()).object();
        restoreEnabled = settings.value("restoreSession").toBool(false);
        serverService = settings.value("serverService").toString();
    }
    sessionFile = qEnvironmentVariable("XDG_STATE_HOME", QDir::homePath() + "/.local/state") +
                  "/derp-media-server/desktop-session.json";
    profile = new QWebEngineProfile("derp-media-client", this);
    installDownloads(profile);
    QString state =
        qEnvironmentVariable("XDG_STATE_HOME", QDir::homePath() + "/.local/state") + "/derp-media-server/qt-desktop";
    profile->setPersistentStoragePath(state);
    profile->setCachePath(state + "/cache");
    profile->setPersistentCookiesPolicy(QWebEngineProfile::ForcePersistentCookies);
    profile->settings()->setAttribute(QWebEngineSettings::LocalContentCanAccessRemoteUrls, false);
}
void Client::error(const QString &message) {
    qWarning().noquote() << message;
    QMessageBox::warning(nullptr, "Derp Media Server", message);
}
void Client::prepareSpare() {
    if (!spare) {
        spare = new ClientWindow(this, {});
        windows.insert(spare);
        auto *window = spare.data();
        connect(window, &QObject::destroyed, this, [this, window] { windows.remove(window); });
    }
}
void Client::openTarget(const QJsonObject &target) {
    prepareSpare();
    auto *window = spare.data();
    spare.clear();
    window->target = target;
    window->targetPending = target.contains("pendingAbsolute");
    window->showTarget();
    if (window->targetPending) {
        window->setRecovery("Opening file…");
        window->checkConnection();
    }
    saveSession();
    if (window->ready && !window->targetPending) {
        emit window->bridge->event("open", target);
        window->showTarget();
    }
    QTimer::singleShot(300, this, &Client::prepareSpare);
}
void Client::openPaths(const QStringList &paths) {
    for (const auto &path : paths)
        openTarget({{"path", ""}, {"isDirectory", true}, {"pendingAbsolute", path}});
}
void Client::handleArguments(const QStringList &args, const QString &cwd) {
    QStringList paths;
    bool tray = false, literal = false;
    for (const auto &arg : args) {
        if (!literal && arg == "--") {
            literal = true;
            continue;
        }
        if (!literal && arg == "--tray") {
            tray = true;
            continue;
        }
        if (!literal && arg.startsWith('-')) {
            error("Unknown option: " + arg);
            return;
        }
        if (arg.startsWith("file:") && (!QUrl(arg).isLocalFile() || !QUrl(arg).host().isEmpty())) {
            error("Only local file URIs are supported");
            return;
        }
        paths << (arg.startsWith("file:") ? QUrl(arg).toLocalFile() : QDir(cwd).absoluteFilePath(arg));
    }
    if (!paths.isEmpty())
        openPaths(paths);
    else if (!tray)
        openTarget({{"path", ""}, {"isDirectory", true}, {"mediaType", "folder"}});
}
void Client::quit() {
    saveSession();
    quitting = true;
    nativeJobs->cancelAll();
    const auto current = windows;
    for (auto *window : current)
        window->close();
    auto *timer = new QTimer(this);
    connect(timer, &QTimer::timeout, this, [this, timer] {
        if (!quitting) {
            timer->stop();
            timer->deleteLater();
            return;
        }
        if (windows.isEmpty() && !nativeJobs->active()) {
            timer->stop();
            qApp->quit();
        }
    });
    timer->start(100);
}

void Client::saveSession() {
    if (!restoreEnabled || quitting)
        return;
    QJsonArray entries;
    for (auto *window : windows)
        if (window->picker.isEmpty() && !window->target.isEmpty())
            entries.append(QJsonObject{{"target", window->target},
                                       {"geometry", QString::fromLatin1(window->saveGeometry().toBase64())}});
    QDir().mkpath(QFileInfo(sessionFile).absolutePath());
    QSaveFile output(sessionFile);
    if (output.open(QIODevice::WriteOnly)) {
        output.write(QJsonDocument(entries).toJson());
        output.commit();
    }
}
void Client::reopenClosed() {
    if (closed.isEmpty())
        return;
    auto target = closed.last().toObject();
    closed.removeLast();
    openTarget(target);
}
bool Client::restoreSession() {
    if (!restoreEnabled)
        return false;
    QFile input(sessionFile);
    if (!input.open(QIODevice::ReadOnly))
        return false;
    auto entries = QJsonDocument::fromJson(input.readAll()).array();
    for (const auto &entry : entries) {
        const auto object = entry.toObject();
        if (object.value("target").toObject().isEmpty())
            continue;
        prepareSpare();
        spare->restoreGeometry(QByteArray::fromBase64(object.value("geometry").toString().toLatin1()));
        openTarget(object.value("target").toObject());
    }
    return !entries.isEmpty();
}

bool Client::setRestoreEnabled(bool enabled) {
    const QString path =
        qEnvironmentVariable("XDG_CONFIG_HOME", QDir::homePath() + "/.config") + "/derp-media-server/desktop.json";
    QFile input(path);
    if (!input.open(QIODevice::ReadOnly)) {
        error(input.errorString());
        return false;
    }
    auto settings = QJsonDocument::fromJson(input.readAll()).object();
    input.close();
    settings.insert("restoreSession", enabled);
    QSaveFile output(path);
    if (!output.open(QIODevice::WriteOnly) || output.write(QJsonDocument(settings).toJson()) < 0 || !output.commit()) {
        error(output.errorString());
        return false;
    }
    restoreEnabled = enabled;
    if (enabled)
        saveSession();
    return true;
}
