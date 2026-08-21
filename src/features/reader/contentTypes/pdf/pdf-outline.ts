import { ReaderOutlineItem } from "../../ReaderOutline";
import { PdfDocument } from "./PdfContent";


export async function mapPdfOutline (
    document: PdfDocument,
    items: Awaited<ReturnType<PdfDocument['getOutline']>>,
  ): Promise<ReaderOutlineItem[]> {
    return    Promise.all(
      (items ?? []).map(async (item, index) => {
        let target = 0
        try {
          const destination =
            typeof item.dest === 'string' ? await document.getDestination(item.dest) : item.dest
          if (destination?.[0])
            target = await document.getPageIndex(
              destination[0] as Parameters<PdfDocument['getPageIndex']>[0],
            )
        } catch {
          target = 0
        }
        return {
          id: `pdf-outline-${index}-${item.title}`,
          label: item.title || `Page ${target + 1}`,
          target,
          children: await mapPdfOutline(document, item.items),
        }
      }),
    )
}