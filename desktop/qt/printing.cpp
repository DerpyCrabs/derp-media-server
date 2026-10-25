#include "printing.h"
#include <QBuffer>
#include <QPainter>
#include <QPdfDocument>
#include <QPointer>
#include <QPrintDialog>
#include <QPrinter>
#include <QProgressDialog>
#include <QTimer>
#include <QWebEngineFrame>
#include <QWebEnginePage>
#include <algorithm>
#include <cmath>

class DocumentPrint : public QObject {
  public:
    DocumentPrint(QWidget *parent, std::function<void(QString)> finished)
        : QObject(parent), parent(parent), finished(std::move(finished)), printer(QPrinter::HighResolution) {
        printer.setResolution(300);
        connect(&document, &QPdfDocument::statusChanged, this, [this](QPdfDocument::Status status) {
            if (done)
                return;
            if (status == QPdfDocument::Status::Ready)
                choosePrinter();
            else if (status == QPdfDocument::Status::Error)
                finish("Could not read the prepared print document.");
        });
    }
    ~DocumentPrint() override {
        if (painter.isActive()) {
            printer.abort();
            painter.end();
        }
        delete dialog;
        delete progress;
    }
    void prepare(QWebEngineFrame frame) {
        QTimer::singleShot(30'000, this, [this] {
            if (!done && !buffer.isOpen())
                finish("Preparing the print document timed out. Try a smaller page "
                       "range.");
        });
        QPointer<DocumentPrint> self(this);
        frame.printToPdf([self](const QByteArray &bytes) {
            if (!self || self->done)
                return;
            if (bytes.isEmpty()) {
                self->finish("Could not prepare the document for printing.");
                return;
            }
            self->buffer.setData(bytes);
            self->buffer.open(QIODevice::ReadOnly);
            self->document.load(&self->buffer);
        });
    }
    void unavailable() {
        finish("The prepared print document is no longer available. Try printing "
               "again.");
    }
    void cancel() {
        cancelled = true;
        if (painter.isActive())
            printer.abort();
        finish();
    }

  private:
    QWidget *parent;
    std::function<void(QString)> finished;
    QPrinter printer;
    QPainter painter;
    QBuffer buffer;
    QPdfDocument document;
    QPointer<QPrintDialog> dialog;
    QPointer<QProgressDialog> progress;
    QList<int> pages;
    int index = 0;
    bool done = false, cancelled = false;
    void finish(QString error = {}) {
        if (done)
            return;
        done = true;
        if (painter.isActive() && !painter.end() && error.isEmpty() && !cancelled)
            error = "The printer could not finish the job.";
        if (dialog)
            dialog->hide();
        if (progress)
            progress->hide();
        finished(error);
        deleteLater();
    }
    void choosePrinter() {
        const int count = document.pageCount();
        if (count < 1 || count > 100) {
            finish("Choose between 1 and 100 pages to print.");
            return;
        }
        const auto title = document.metaData(QPdfDocument::MetaDataField::Title).toString();
        printer.setDocName(title.isEmpty() ? "Derp document" : title);
        dialog = new QPrintDialog(&printer, parent);
        dialog->setWindowTitle("Print document");
        dialog->setMinMax(1, count);
        dialog->setFromTo(1, count);
        dialog->setOption(QAbstractPrintDialog::PrintPageRange, true);
        dialog->setOption(QAbstractPrintDialog::PrintSelection, false);
        dialog->setOption(QAbstractPrintDialog::PrintCurrentPage, false);
        connect(dialog, &QDialog::rejected, this, [this] { finish(); });
        connect(dialog, &QDialog::accepted, this, [this, count] {
            if (done)
                return;
            const int first =
                printer.printRange() == QPrinter::PageRange ? std::clamp(printer.fromPage(), 1, count) : 1;
            const int last =
                printer.printRange() == QPrinter::PageRange ? std::clamp(printer.toPage(), first, count) : count;
            for (int page = first; page <= last; ++page)
                pages.append(page - 1);
            if (printer.pageOrder() == QPrinter::LastPageFirst)
                std::reverse(pages.begin(), pages.end());
            if (!printer.supportsMultipleCopies() && printer.copyCount() > 1) {
                const auto original = pages;
                pages.clear();
                if (printer.collateCopies()) {
                    for (int copy = 0; copy < printer.copyCount(); ++copy)
                        pages.append(original);
                } else {
                    for (int page : original)
                        for (int copy = 0; copy < printer.copyCount(); ++copy)
                            pages.append(page);
                }
            }
            if (!painter.begin(&printer)) {
                finish("Cannot start this printer. Check its connection and try again.");
                return;
            }
            progress = new QProgressDialog("Printing document…", "Cancel", 0, pages.size(), parent);
            progress->setWindowModality(Qt::WindowModal);
            progress->setMinimumDuration(0);
            progress->setAutoClose(false);
            connect(progress, &QProgressDialog::canceled, this, [this] { cancel(); });
            QTimer::singleShot(0, this, [this] { nextPage(); });
        });
        dialog->open();
    }
    void nextPage() {
        if (done)
            return;
        if (index >= pages.size()) {
            finish();
            return;
        }
        if (index && !printer.newPage()) {
            finish("The printer could not accept the next page.");
            return;
        }
        const auto points = document.pagePointSize(pages[index]);
        if (points.isEmpty()) {
            finish("The print document contains an invalid page.");
            return;
        }
        const double scale = std::min(300.0 / 72.0, std::sqrt(20'000'000.0 / (points.width() * points.height())));
        const QSize size(std::max(1, int(std::ceil(points.width() * scale))),
                         std::max(1, int(std::ceil(points.height() * scale))));
        const auto image = document.render(pages[index], size);
        if (image.isNull()) {
            finish("Could not render a page for printing.");
            return;
        }
        const QRectF area(QPointF(0, 0), printer.pageRect(QPrinter::DevicePixel).size());
        const auto fitted = QSizeF(image.size()).scaled(area.size(), Qt::KeepAspectRatio);
        const QRectF target(area.center().x() - fitted.width() / 2, area.center().y() - fitted.height() / 2,
                            fitted.width(), fitted.height());
        painter.drawImage(target, image);
        progress->setValue(++index);
        QTimer::singleShot(0, this, [this] { nextPage(); });
    }
};
QObject *printDocumentFrame(QWebEnginePage *page, QWidget *parent, const QString &name,
                            std::function<void(QString)> finished) {
    auto *job = new DocumentPrint(parent, std::move(finished));
    QTimer::singleShot(0, job, [job, page = QPointer<QWebEnginePage>(page), name] {
        const auto frame = page ? page->findFrameByName(name) : std::nullopt;
        if (!frame || !frame->isValid()) {
            job->unavailable();
            return;
        }
        job->prepare(*frame);
    });
    return job;
}
void cancelDocumentPrint(QObject *job) {
    if (job)
        static_cast<DocumentPrint *>(job)->cancel();
}
