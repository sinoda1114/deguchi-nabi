/**
 * ページ描画前にdata-theme属性を確定させるための初期化スクリプト。
 * next-themes(React19+Next16のApp Routerでクラッシュ済み、削除済み)は使わず、
 * next/scriptのbeforeInteractiveで直接注入する(FOUC対策)。
 * 保存済みの選択が無ければ"light"をデフォルトにする(OSのダークモード設定に
 * 関わらずライトを既定にしてほしいというフィードバックに基づく)。
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var theme = stored === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();
`;
