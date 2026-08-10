import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "Avíspate — juego de agilidad visual";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const iconData = await readFile(
    join(process.cwd(), "app", "icon.png"),
    "base64",
  );
  const iconSrc = `data:image/png;base64,${iconData}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "72px 92px",
          background:
            "linear-gradient(135deg, #fffdf4 0%, #fff2b6 46%, #ffc20e 100%)",
          color: "#111111",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
          }}
        >
          <img
            src={iconSrc}
            alt=""
            width="330"
            height="330"
            style={{
              borderRadius: "76px",
              boxShadow: "0 24px 52px rgba(17, 17, 17, 0.18)",
            }}
          />

          <div
            style={{
              display: "flex",
              flex: 1,
              flexDirection: "column",
              alignItems: "flex-start",
              marginLeft: "70px",
            }}
          >
            <div
              style={{
                fontSize: "86px",
                fontWeight: 800,
                letterSpacing: "-3px",
                lineHeight: 1,
              }}
            >
              ¡Avíspate!
            </div>
            <div
              style={{
                marginTop: "30px",
                fontSize: "36px",
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              Encuentra el símbolo común.
            </div>
            <div
              style={{
                marginTop: "10px",
                fontSize: "36px",
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              Sé el más rápido.
            </div>
            <div
              style={{
                display: "flex",
                marginTop: "34px",
                padding: "11px 22px",
                borderRadius: "999px",
                background: "#111111",
                color: "#ffffff",
                fontSize: "24px",
                fontWeight: 700,
              }}
            >
              Juego de agilidad visual
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
