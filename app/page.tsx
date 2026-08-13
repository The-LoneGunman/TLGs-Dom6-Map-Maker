import { MapMakerApp } from "@/src/MapMakerApp";

export default function Home() {
  return <>
    <noscript>
      <div role="alert" style={{ padding: "1rem", color: "#efe8d4", background: "#0f1516" }}>
        Pantokrator Atlas requires JavaScript to generate, edit, and export maps. Enable JavaScript, then reload this page.
      </div>
    </noscript>
    <MapMakerApp />
  </>;
}
