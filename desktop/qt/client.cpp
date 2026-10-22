#include "client.h"
#include <KWindowSystem>
#include <QClipboard>
#include <QCloseEvent>
#include <QDir>
#include <QDrag>
#include <QDropEvent>
#include <QFile>
#include <QFutureWatcher>
#include <QMessageBox>
#include <QMimeData>
#include <QShortcut>
#include <QTimer>
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
class Page : public QWebEnginePage {
  public:
    Page(QWebEngineProfile *profile, QString origin, QObject *parent)
        : QWebEnginePage(profile, parent), origin(std::move(origin)) {}

  protected:
    bool acceptNavigationRequest(const QUrl &url, NavigationType, bool main) override {
        return !main ||
               (url.adjusted(QUrl::RemovePath | QUrl::RemoveQuery | QUrl::RemoveFragment).toString() == origin &&
                url.path() == "/desktop");
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
    : target(std::move(target)), picker(std::move(picker)) {
    setAttribute(Qt::WA_DeleteOnClose);
    if (!this->picker.isEmpty()) {
        setWindowFlag(Qt::Dialog);
        // Native modal hint also identifies parentless portal dialogs to Wayland compositors.
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
    connect(this, &QWebEngineView::loadFinished, this, [this, client](bool success) {
        if (!success && !this->target.isEmpty()) {
            client->error("Cannot load desktop UI at " + client->server.origin);
            approvedClose = true;
            close();
        }
    });
    auto *shortcut = new QShortcut(QKeySequence("Ctrl+N"), this);
    connect(shortcut, &QShortcut::activated, client,
            [client] { client->openTarget({{"path", ""}, {"isDirectory", true}, {"mediaType", "folder"}}); });
    auto *closeShortcut = new QShortcut(QKeySequence("Ctrl+W"), this);
    connect(closeShortcut, &QShortcut::activated, this, &QWidget::close);
    qApp->installEventFilter(this);
    this->parentHandle = parentHandle;
    load(QUrl(client->server.origin + "/desktop?warm=1"));
    QTimer::singleShot(20000, this, [this, client] {
        if (!ready && !this->target.isEmpty()) {
            client->error("Desktop UI did not become ready");
            approvedClose = true;
            close();
        }
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
    // A never-assigned warm page has no user document or persistence work to flush.
    if (ready && !approvedClose && picker.isEmpty() && !target.isEmpty()) {
        event->ignore();
        if (!closing) {
            closing = true;
            emit bridge->event("before-close", {});
        }
        return;
    }
    QWebEngineView::closeEvent(event);
}
Bridge::Bridge(Client *client, ClientWindow *window) : QObject(window), client(client), window(window) {}
void Bridge::call(const QString &id, const QString &method, const QJsonArray &args) {
    auto respond = [this, id](QJsonValue value = QJsonValue()) { emit reply(id, {{"value", value}}); };
    if (method == "ready") {
        window->ready = true;
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
        if (!args.isEmpty() && !args[0].toString().isEmpty())
            client->error(args[0].toString());
        else
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
        // Portal validation completes asynchronously and reports errors through this bridge.
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
    const auto server = client->server;
    background(
        this,
        [server, method, args, sources]() -> QJsonObject {
            if (method == "open") {
                if (args[0].toString().isEmpty())
                    return {{"path", ""}, {"isDirectory", true}, {"mediaType", "folder"}};
                auto target = server.resolve(args[0].toString());
                target["reader"] = args.size() > 1 && args[1].toBool();
                if (target.value("mediaType") == "audio")
                    throw std::runtime_error("Audio playback is not included yet");
                return target;
            }
            if (method == "copy" || method == "drag" || method == "open-drop") {
                QJsonArray paths, targets;
                const auto values = method == "open-drop" ? sources : jsonStrings(args[0].toArray());
                for (const auto &path : values) {
                    auto target = server.resolve(path, method == "open-drop");
                    paths.append(target.value("absolutePath"));
                    targets.append(target);
                }
                return {{"paths", paths}, {"targets", targets}};
            }
            if (method == "paste" || method == "import-drop")
                return {{"count", server.importFiles(sources, args[0].toString())}};
            throw std::runtime_error("Unknown desktop operation");
        },
        [this, id, method](QJsonObject result) {
            if (result.contains("error")) {
                emit reply(id, result);
                return;
            }
            const auto value = result.value("value").toObject();
            if (method == "open")
                client->openTarget(value);
            if (method == "open-drop")
                for (const auto &target : value.value("targets").toArray())
                    client->openTarget(target.toObject());
            if (method == "copy" || method == "drag") {
                auto *mime = new QMimeData;
                QList<QUrl> urls;
                for (const auto &path : value.value("paths").toArray())
                    urls << QUrl::fromLocalFile(path.toString());
                mime->setUrls(urls);
                QByteArray copied("copy\n");
                for (const auto &url : urls)
                    copied += url.toEncoded() + '\n';
                mime->setData("x-special/gnome-copied-files", copied);
                if (method == "copy")
                    QApplication::clipboard()->setMimeData(mime);
                else {
                    auto *drag = new QDrag(window);
                    drag->setMimeData(mime);
                    drag->setPixmap(QIcon(":/desktop/icon.svg").pixmap(32, 32));
                    drag->exec(Qt::CopyAction);
                    drag->deleteLater();
                }
            }
            emit reply(id, {{"value", value.value("count")}});
        });
}
Client::Client(QString origin) : server(std::move(origin)) {
    profile = new QWebEngineProfile("derp-media-client", this);
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
    if (window->ready) {
        emit window->bridge->event("open", target);
        window->showTarget();
    }
    QTimer::singleShot(300, this, &Client::prepareSpare);
}
void Client::openPaths(const QStringList &paths) {
    const auto server = this->server;
    for (const auto &path : paths)
        background(
            this,
            [server, path] {
                auto result = server.resolve(path, true);
                if (result.value("mediaType") == "audio")
                    throw std::runtime_error("Audio playback is not included yet");
                return result;
            },
            [this](QJsonObject result) {
                if (result.contains("error"))
                    error(result.value("error").toString());
                else
                    openTarget(result.value("value").toObject());
            });
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
    const auto current = windows;
    for (auto *window : current)
        window->close();
    auto *timer = new QTimer(this);
    connect(timer, &QTimer::timeout, this, [this, timer] {
        if (windows.isEmpty()) {
            timer->stop();
            qApp->quit();
        }
    });
    timer->start(100);
}
