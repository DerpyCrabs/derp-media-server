#include <KWaylandExtras>
#include <QApplication>
#include <QTimer>
#include <QWidget>
#include <cstdio>
int main(int argc, char **argv) {
    QApplication app(argc, argv);
    QWidget window;
    window.setWindowTitle("Derp portal test caller");
    window.resize(640, 480);
    window.show();
    KWaylandExtras::exportToplevel(window.windowHandle()).then(&app, [](const QString &handle) {
        printf("wayland:%s\n", handle.toUtf8().constData());
        fflush(stdout);
    });
    QTimer::singleShot(120000, &app, &QCoreApplication::quit);
    return app.exec();
}
