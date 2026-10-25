#pragma once
#include <QString>
#include <functional>
class QObject;
class QWidget;
class QWebEnginePage;
QObject *printDocumentFrame(QWebEnginePage *page, QWidget *parent, const QString &name,
                            std::function<void(QString)> finished);
void cancelDocumentPrint(QObject *job);
