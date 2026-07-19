import { describe, expect, test } from "vitest";
import { escapeLikePrefix } from "../turso-kv-store";

describe("escapeLikePrefix", () => {
  test("英数のみ(_も%も含まない)のprefixは末尾に%が付くだけ", () => {
    expect(escapeLikePrefix("stshibuya")).toBe("stshibuya%");
  });

  test("アンダースコアをエスケープする(stationIdはhr_..._...のように_を含み、素のLIKEでは任意1文字扱いで別キーへ誤マッチするため)", () => {
    expect(escapeLikePrefix("hr_横浜_139.6199_35.4658")).toBe("hr\\_横浜\\_139.6199\\_35.4658%");
  });

  test("パーセント記号をエスケープする", () => {
    expect(escapeLikePrefix("a%b")).toBe("a\\%b%");
  });

  test("バックスラッシュ(エスケープ文字自体)をエスケープする", () => {
    expect(escapeLikePrefix("a\\b")).toBe("a\\\\b%");
  });

  test("空文字は%のみになる(全件前方一致)", () => {
    expect(escapeLikePrefix("")).toBe("%");
  });
});
