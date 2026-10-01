import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

// Web-only document shell. Native builds never render this file.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>ReadMate</title>
        <meta name="description" content="ReadMate turns articles, PDFs, and feeds into natural listening, with study tools built from what you read." />
        <meta name="theme-color" content="#f5f1e8" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: "html, body { background-color: #f5f1e8; }" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
