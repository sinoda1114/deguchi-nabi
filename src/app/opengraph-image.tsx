import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";

export const alt = "でぐちなび — 乗換え・駅構内ナビゲーション";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "nodejs";

const navy = "#062d65";
const blue = "#075bff";

export default async function OpenGraphImage() {
  let iconSrc: string;
  try {
    const iconData = await readFile(new URL("./icon.png", import.meta.url));
    iconSrc = `data:image/png;base64,${iconData.toString("base64")}`;
  } catch (error) {
    throw new Error(`Failed to load icon.png: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#f8fafd",
          color: navy,
          display: "flex",
          fontFamily: "sans-serif",
          height: "100%",
          padding: "78px 84px",
          width: "100%",
        }}
      >
        <img
          alt=""
          height={270}
          src={iconSrc}
          style={{ display: "flex" }}
          width={270}
        />

        <div style={{ display: "flex", flexDirection: "column", marginLeft: 52 }}>
          <div
            style={{
              color: blue,
              display: "flex",
              fontSize: 55,
              fontWeight: 700,
              letterSpacing: 2,
            }}
          >
            乗換え・駅構内ナビ
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 114,
              fontWeight: 900,
              letterSpacing: -4,
              marginTop: 18,
            }}
          >
            でぐちなび
          </div>
          <div
            style={{
              color: "#42648f",
              display: "flex",
              flexDirection: "column",
              fontSize: 57,
              fontWeight: 700,
              lineHeight: 1.15,
              marginTop: 20,
            }}
          >
            <span>号車・乗換・改札</span>
            <span>出口まで</span>
          </div>
          <div
            style={{
              alignItems: "center",
              color: navy,
              display: "flex",
              fontSize: 46,
              fontWeight: 700,
              marginTop: 30,
            }}
          >
            <span style={{ color: blue, fontSize: 62, lineHeight: 1 }}>●</span>
            <span style={{ marginLeft: 16 }}>迷わない移動を案内</span>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
