#include "client.h"
#include "portal.h"
#include <QDBusConnection>
#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QLocalServer>
#include <QLocalSocket>
#include <QLockFile>
#include <QMenu>
#include <QSocketNotifier>
#include <QStandardPaths>
#include <QSystemTrayIcon>
#include <QTimer>
#include <signal.h>
#include <sys/signalfd.h>
#include <unistd.h>

int main(int argc, char **argv) {
    sigset_t signalMask;
    sigemptyset(&signalMask);
    sigaddset(&signalMask, SIGTERM);
    sigaddset(&signalMask, SIGINT);
    sigprocmask(SIG_BLOCK, &signalMask, nullptr);
    QApplication::setApplicationName("derp-media-client");
    QApplication::setOrganizationName("derp-media-server");
    QApplication::setDesktopFileName("derp-media-client");
    const QString configDir =
        qEnvironmentVariable("XDG_CONFIG_HOME", QDir::homePath() + "/.config") + "/derp-media-server";
    const QStringList arguments = [&] {
        QStringList result;
        for (int i = 1; i < argc; ++i)
            result << QString::fromLocal8Bit(argv[i]);
        return result;
    }();
    if (arguments.contains("--help") || arguments.contains("-h")) {
        printf("Usage: derp-media-client [--tray] [--] [FILE_OR_DIRECTORY ...]\n");
        return 0;
    }
    QDir().mkpath(configDir);
    const QString socketName = configDir + "/desktop.sock";
    // Construct the Qt event loop before using local sockets, but do not initialize a webview for CLI forwarding.
    QApplication app(argc, argv);
    app.setQuitOnLastWindowClosed(false);
    app.setWindowIcon(QIcon(":/desktop/icon.svg"));
    QLocalSocket socket;
    socket.connectToServer(socketName);
    if (socket.waitForConnected(300)) {
        socket.write(
            QJsonDocument(QJsonObject{{"args", QJsonArray::fromStringList(arguments)}, {"cwd", QDir::currentPath()}})
                .toJson(QJsonDocument::Compact) +
            '\n');
        socket.waitForBytesWritten(2000);
        return 0;
    }
    QLockFile lock(configDir + "/desktop.lock");
    if (!lock.tryLock(2000)) {
        qCritical() << "Another desktop client is starting";
        return 1;
    }
    QLocalServer local;
    local.setSocketOptions(QLocalServer::UserAccessOption);
    QLocalServer::removeServer(socketName);
    if (!local.listen(socketName)) {
        qCritical() << local.errorString();
        return 1;
    }
    QFile config(configDir + "/desktop.json");
    if (!config.exists()) {
        if (!config.open(QIODevice::WriteOnly)) {
            qCritical() << config.errorString();
            return 1;
        }
        config.write("{\"port\":3000}\n");
        config.close();
    }
    if (!config.open(QIODevice::ReadOnly)) {
        qCritical() << config.errorString();
        return 1;
    }
    const auto portValue = QJsonDocument::fromJson(config.readAll()).object().value("port");
    const int port = portValue.toInt();
    if (!portValue.isDouble() || port < 1 || port > 65535 || portValue.toDouble() != port) {
        qCritical() << "desktop.json requires an integer port from 1 to 65535";
        return 1;
    }
    Client client(QString("http://127.0.0.1:%1").arg(port));
    QObject::connect(&local, &QLocalServer::newConnection, &client, [&] {
        while (auto *peer = local.nextPendingConnection()) {
            QObject::connect(peer, &QLocalSocket::readyRead, &client, [&, peer] {
                if (peer->bytesAvailable() > 1024 * 1024) {
                    peer->disconnectFromServer();
                    return;
                }
                if (!peer->canReadLine())
                    return;
                const auto message = QJsonDocument::fromJson(peer->readLine()).object();
                client.handleArguments(jsonStrings(message.value("args").toArray()), message.value("cwd").toString());
                peer->disconnectFromServer();
            });
            QObject::connect(peer, &QLocalSocket::disconnected, peer, &QObject::deleteLater);
        }
    });
    Portal portal(&client);
    auto bus = QDBusConnection::sessionBus();
    const QString portalName = qEnvironmentVariable("DERP_PORTAL_BUS_NAME", "org.freedesktop.impl.portal.desktop.derp");
    if (!bus.registerService(portalName) ||
        !bus.registerVirtualObject("/org/freedesktop/portal/desktop", &portal, QDBusConnection::SubPath))
        qWarning() << "Could not register file chooser portal:" << bus.lastError();
    QSystemTrayIcon tray(QIcon(":/desktop/icon.svg"));
    QMenu menu;
    menu.addAction("New browser window", &client, [&] { client.handleArguments({}, QDir::currentPath()); });
    menu.addAction("Quit", &client, &Client::quit);
    tray.setContextMenu(&menu);
    tray.setToolTip("Derp Media Server");
    tray.show();
    QObject::connect(&tray, &QSystemTrayIcon::activated, &client, [&](QSystemTrayIcon::ActivationReason reason) {
        if (reason == QSystemTrayIcon::Trigger)
            client.handleArguments({}, QDir::currentPath());
    });
    int fd = signalfd(-1, &signalMask, SFD_NONBLOCK | SFD_CLOEXEC);
    QSocketNotifier notifier(fd, QSocketNotifier::Read);
    QObject::connect(&notifier, &QSocketNotifier::activated, &client, [&] {
        signalfd_siginfo info;
        if (::read(fd, &info, sizeof(info)) > 0)
            client.quit();
    });
    client.prepareSpare();
    client.handleArguments(arguments, QDir::currentPath());
    const int result = app.exec();
    const auto windows = client.windows;
    for (auto *window : windows)
        delete window;
    ::close(fd);
    return result;
}
