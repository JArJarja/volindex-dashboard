// pages/_document.tsx
import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="fr">
      <Head>
        <meta charSet="utf-8" />
        <meta name="description" content="Outil d'analyse de marché informatif. Ne constitue pas un conseil en investissement." />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📊</text></svg>" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
