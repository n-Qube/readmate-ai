import type { prisma as PrismaSingleton } from "../prisma.js";

type CleanupOptions = {
  includeNotesAndHighlights?: boolean;
};

export async function clearLearningDataForDocument(
  prisma: typeof PrismaSingleton,
  userId: string,
  documentId: string,
  options: CleanupOptions = {}
): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.learningFlashcard.updateMany({
      where: { userId, documentId, deletedAt: null },
      data: { deletedAt: now }
    }),
    prisma.learningQuizQuestion.updateMany({
      where: { userId, documentId, deletedAt: null },
      data: { deletedAt: now }
    }),
    prisma.learningQuizAttempt.deleteMany({ where: { userId, documentId } }),
    ...(options.includeNotesAndHighlights
      ? [
          prisma.note.updateMany({
            where: { userId, documentId, deletedAt: null },
            data: { deletedAt: now }
          }),
          prisma.highlight.updateMany({
            where: { userId, documentId, deletedAt: null },
            data: { deletedAt: now }
          })
        ]
      : []),
    prisma.readingDocument.updateMany({
      where: { id: documentId, userId, deletedAt: null },
      data: {
        summary: null,
        keyPoints: "[]",
        flashcards: "[]",
        quizQuestions: "[]"
      }
    })
  ]);
}

export async function clearLearningDataForDocuments(
  prisma: typeof PrismaSingleton,
  userId: string,
  documentIds: string[],
  options: CleanupOptions = {}
): Promise<void> {
  const uniqueDocumentIds = [...new Set(documentIds.filter(Boolean))];
  if (!uniqueDocumentIds.length) return;
  const now = new Date();
  await prisma.$transaction([
    prisma.learningFlashcard.updateMany({
      where: { userId, documentId: { in: uniqueDocumentIds }, deletedAt: null },
      data: { deletedAt: now }
    }),
    prisma.learningQuizQuestion.updateMany({
      where: { userId, documentId: { in: uniqueDocumentIds }, deletedAt: null },
      data: { deletedAt: now }
    }),
    prisma.learningQuizAttempt.deleteMany({ where: { userId, documentId: { in: uniqueDocumentIds } } }),
    ...(options.includeNotesAndHighlights
      ? [
          prisma.note.updateMany({
            where: { userId, documentId: { in: uniqueDocumentIds }, deletedAt: null },
            data: { deletedAt: now }
          }),
          prisma.highlight.updateMany({
            where: { userId, documentId: { in: uniqueDocumentIds }, deletedAt: null },
            data: { deletedAt: now }
          })
        ]
      : []),
    prisma.readingDocument.updateMany({
      where: { id: { in: uniqueDocumentIds }, userId, deletedAt: null },
      data: {
        summary: null,
        keyPoints: "[]",
        flashcards: "[]",
        quizQuestions: "[]"
      }
    })
  ]);
}
