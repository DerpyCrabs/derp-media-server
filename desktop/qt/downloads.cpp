#include "downloads.h"
#include <QDir>
#include <QFileDialog>
#include <QFileInfo>
#include <QMessageBox>
#include <QPointer>
#include <QProgressDialog>
#include <QSettings>
#include <QStandardPaths>
#include <QTimer>
#include <QWebEngineDownloadRequest>
#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QWebEngineView>

namespace {
class DocumentDownload final : public QObject {
  public:
    QUrl url;
    QPointer<QWebEngineDownloadRequest> request;
    QTimer timeout;
    std::function<void(bool, QString)> finished;
    DocumentDownload(QWebEnginePage *page, QUrl source, std::function<void(bool, QString)> callback)
        : QObject(page), url(std::move(source)), finished(std::move(callback)) {
        timeout.setSingleShot(true);
        QObject::connect(&timeout, &QTimer::timeout, this,
                         [this] { complete(false, "The download did not start. Please try again."); });
        timeout.start(30000);
    }
    ~DocumentDownload() override {
        if (request)
            QObject::disconnect(request, nullptr, this, nullptr);
        if (request && !request->isFinished())
            request->cancel();
    }
    void complete(bool saved, const QString &error = {}) {
        timeout.stop();
        auto callback = std::move(finished);
        if (callback)
            callback(saved, error);
        deleteLater();
    }
    void attach(QWebEngineDownloadRequest *download) {
        timeout.stop();
        request = download;
        QObject::connect(download, &QWebEngineDownloadRequest::isFinishedChanged, this, [this] {
            if (!request || !request->isFinished())
                return;
            complete(request->state() == QWebEngineDownloadRequest::DownloadCompleted,
                     request->state() == QWebEngineDownloadRequest::DownloadInterrupted
                         ? request->interruptReasonString()
                         : QString());
        });
        QObject::connect(download, &QObject::destroyed, this, [this] {
            if (finished)
                complete(false, "The download was interrupted.");
        });
    }
};
DocumentDownload *trackedDownload(QWebEnginePage *page, const QUrl &url) {
    if (!page)
        return nullptr;
    for (auto *child : page->children()) {
        auto *download = dynamic_cast<DocumentDownload *>(child);
        if (download && download->url == url && download->finished)
            return download;
    }
    return nullptr;
}
} // namespace
void downloadDocumentBlob(QWebEnginePage *page, const QUrl &url, const QString &name,
                          std::function<void(bool, QString)> finished) {
    if (trackedDownload(page, url)) {
        finished(false, "This download is already in progress.");
        return;
    }
    new DocumentDownload(page, url, std::move(finished));
    page->download(url, QFileInfo(name).fileName());
}
void cancelDocumentDownload(QWebEnginePage *page, const QUrl &url) {
    if (auto *download = trackedDownload(page, url)) {
        if (download->request)
            download->request->cancel();
        download->complete(false);
    }
}

void installDownloads(QWebEngineProfile *profile) {
    QObject::connect(profile, &QWebEngineProfile::downloadRequested, profile, [](QWebEngineDownloadRequest *request) {
        if (request->isSavePageDownload()) {
            request->cancel();
            request->deleteLater();
            return;
        }
        QPointer<DocumentDownload> tracked(trackedDownload(request->page(), request->url()));
        if (tracked)
            tracked->attach(request);
        QPointer<QWebEngineDownloadRequest> download(request);
        QPointer<QWidget> parent(QWebEngineView::forPage(request->page()));
        QSettings settings;
        const auto folder =
            settings.value("downloads/folder", QStandardPaths::writableLocation(QStandardPaths::DownloadLocation))
                .toString();
        auto name = QFileInfo(request->suggestedFileName()).fileName();
        if (name.isEmpty() || name == "." || name == "..")
            name = "Download";
        // Avoid calling our own FileChooser portal recursively from its host
        // process.
        const auto path = QFileDialog::getSaveFileName(parent, "Save download", QDir(folder).filePath(name), {},
                                                       nullptr, QFileDialog::DontUseNativeDialog);
        if (!download)
            return;
        if (download->state() != QWebEngineDownloadRequest::DownloadRequested) {
            download->deleteLater();
            return;
        }
        if (path.isEmpty()) {
            download->cancel();
            download->deleteLater();
            return;
        }
        const QFileInfo destination(path);
        settings.setValue("downloads/folder", destination.absolutePath());
        download->setDownloadDirectory(destination.absolutePath());
        download->setDownloadFileName(destination.fileName());
        QPointer<QProgressDialog> progress(
            new QProgressDialog("Saving " + destination.fileName(), "Cancel", 0, 100, parent));
        progress->setWindowTitle("Download");
        progress->setWindowModality(Qt::NonModal);
        progress->setMinimumDuration(500);
        progress->setAutoClose(false);
        progress->setAutoReset(false);
        QObject::connect(progress, &QProgressDialog::canceled, download, &QWebEngineDownloadRequest::cancel);
        QObject::connect(progress, &QObject::destroyed, download, [download] {
            if (download && !download->isFinished())
                download->cancel();
        });
        const auto update = [download, progress] {
            if (!download || !progress)
                return;
            const auto total = download->totalBytes();
            progress->setMaximum(total > 0 ? 100 : 0);
            if (total > 0)
                progress->setValue(int(100.0 * download->receivedBytes() / total));
        };
        QObject::connect(download, &QWebEngineDownloadRequest::receivedBytesChanged, progress, update);
        QObject::connect(download, &QWebEngineDownloadRequest::totalBytesChanged, progress, update);
        QObject::connect(download, &QWebEngineDownloadRequest::isFinishedChanged, download,
                         [download, progress, parent, tracked] {
                             if (!download || !download->isFinished())
                                 return;
                             if (progress) {
                                 progress->hide();
                                 progress->deleteLater();
                             }
                             if (!tracked && download->state() == QWebEngineDownloadRequest::DownloadInterrupted)
                                 QMessageBox::warning(parent, "Download failed", download->interruptReasonString());
                             download->deleteLater();
                         });
        update();
        download->accept();
    });
}
