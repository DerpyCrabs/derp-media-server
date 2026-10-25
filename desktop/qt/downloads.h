#pragma once
#include <QString>
#include <QUrl>
#include <functional>
class QWebEngineProfile;
class QWebEnginePage;
void installDownloads(QWebEngineProfile *profile);
void downloadDocumentBlob(QWebEnginePage *page, const QUrl &url, const QString &name,
                          std::function<void(bool, QString)> finished);
void cancelDocumentDownload(QWebEnginePage *page, const QUrl &url);
