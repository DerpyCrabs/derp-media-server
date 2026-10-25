#include "downloads.h"
#include <QDir>
#include <QFileDialog>
#include <QFileInfo>
#include <QMessageBox>
#include <QPointer>
#include <QProgressDialog>
#include <QSettings>
#include <QStandardPaths>
#include <QWebEngineDownloadRequest>
#include <QWebEngineProfile>
#include <QWebEngineView>

void installDownloads(QWebEngineProfile *profile) {
    QObject::connect(profile, &QWebEngineProfile::downloadRequested, profile, [](QWebEngineDownloadRequest *request) {
        if (request->isSavePageDownload()) {
            request->cancel();
            return;
        }
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
        if (path.isEmpty()) {
            download->cancel();
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
                         [download, progress, parent] {
                             if (!download || !download->isFinished())
                                 return;
                             if (progress) {
                                 progress->hide();
                                 progress->deleteLater();
                             }
                             if (download->state() == QWebEngineDownloadRequest::DownloadInterrupted)
                                 QMessageBox::warning(parent, "Download failed", download->interruptReasonString());
                             download->deleteLater();
                         });
        update();
        download->accept();
    });
}
