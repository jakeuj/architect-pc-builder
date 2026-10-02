"""build 檔 match (品名子字串) 對應到原價屋品項的共用邏輯, quote.py 與 build_site.py 都用這裡。

原價屋的 option value 只是清單位置, 每次抓價都可能變; 品名才是穩定鍵。
"""


def resolve(items, match, prev_name=None):
    """在 items (同一分類的品項 list) 裡找 match。

    回傳 (item, status, candidates):
      status = "ok"        唯一命中; 同品名重複上架 (特價區 + 品牌群組) 視為同一件, 取第一筆
               "missing"   找不到 (多半是下架)
               "ambiguous" 命中多個不同品名, 且沒有完全相等的品名、上一版對到的品名也不在其中
    """
    uniq = {}
    for it in items:
        if match in it["name"]:
            uniq.setdefault(it["name"], it)
    cands = list(uniq.values())
    if len(cands) == 1:
        return cands[0], "ok", cands
    if match in uniq:
        return uniq[match], "ok", cands
    if prev_name and prev_name in uniq:
        return uniq[prev_name], "ok", cands
    return None, ("ambiguous" if cands else "missing"), cands
