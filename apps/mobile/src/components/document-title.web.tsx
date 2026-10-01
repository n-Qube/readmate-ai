import Head from "expo-router/head";

/** Expo Router otherwise emits an empty <title>, leaving the browser tab blank. */
export function DocumentTitle({ title }: { title: string }) {
  return (
    <Head>
      <title>{title}</title>
    </Head>
  );
}
