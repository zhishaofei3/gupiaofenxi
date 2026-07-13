# -*- coding: utf-8 -*-
import pandas as pd
import datetime
import time
import requests
import warnings
warnings.filterwarnings("ignore")

STOCKS = [
'688722', '300129', '600664', '601608', '002606', '600428', '603223', '000933',
'601858', '000920', '603698', '603162', '600685', '000887', '002970', '603236',
'603155', '603270', '605090', '603556', '001395', '002402', '002202', '002346',
'003020', '002479', '600129', '000938', '605377', '002185', '603020', '603339',
'603087', '600488', '002815', '600360', '600988', '301596', '603928', '603931',
'000975', '000977', '601100', '000021', '300718', '601689', '300018', '605319',
'300684', '601069', '001287', '003011', '603296', '002841', '001337', '600143',
'603757', '603012', '603303', '600120', '601121', '603165', '002536', '601369',
'002674', '603596', '600770', '001206', '002409', '300017', '002156', '001230',
'600584', '603726', '002546', '603005', '002632', '000811', '002152', '301607',
'301379', '002916', '001207', '000417', '002396', '603156'
]

def get_sina_code(code):
    return f"sh{code}" if code.startswith("6") else f"sz{code}"

# 1. 实时价格
def get_price(code):
    try:
        sc = get_sina_code(code)
        url = f"http://hq.sinajs.cn/list={sc}"
        headers = {"Referer": "https://finance.sina.com"}
        r = requests.get(url, headers=headers, timeout=2)
        data = r.text.split('"')[1].split(",")
        return float(data[3])
    except:
        return 0.0

# 2. 新浪日线
def get_sina_daily(code, datalen=10):
    try:
        sc = get_sina_code(code)
        url = "http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData"
        params = {"symbol": sc, "scale": 240, "ma": "no", "datalen": datalen}
        r = requests.get(url, params=params, timeout=3)
        df = pd.DataFrame(r.json())
        df["close"] = df["close"].astype(float)
        df["high"] = df["high"].astype(float)
        return df
    except:
        return pd.DataFrame()

# 3. 新浪15分钟（实时）
def get_sina_15min(code, datalen=50):
    try:
        sc = get_sina_code(code)
        url = "http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData"
        params = {"symbol": sc, "scale": 15, "ma": "no", "datalen": datalen}
        r = requests.get(url, params=params, timeout=3)
        df = pd.DataFrame(r.json())
        df["close"] = df["close"].astype(float)
        return df
    except:
        return pd.DataFrame()

# MACD — 与三方股票软件（同花顺/东方财富/通达信）一致
# EMA种子值使用前N根的SMA，而非第1根收盘价
def calc_ema(values, period):
    k = 2 / (period + 1)
    result = []
    # 前period-1根用收盘价填充
    for i in range(min(period - 1, len(values))):
        result.append(values[i])
    if len(values) >= period:
        # 种子值 = 前N根的SMA
        sma = sum(values[:period]) / period
        result.append(sma)
        prev = sma
        for i in range(period, len(values)):
            prev = values[i] * k + prev * (1 - k)
            result.append(prev)
    return result

def calc_macd(df):
    df = df.copy()
    closes = df["close"].tolist()
    ema12 = calc_ema(closes, 12)
    ema26 = calc_ema(closes, 26)
    df["DIF"] = [ema12[i] - ema26[i] for i in range(len(closes))]
    dea = calc_ema(df["DIF"].tolist(), 9)
    df["DEA"] = dea
    df["MACD"] = 2 * (df["DIF"] - df["DEA"])
    return df

# 选股
def check(code):
    price = get_price(code)
    df_day = get_sina_daily(code, 10)
    ma5 = 0.0
    zt_ok = False

    if len(df_day) >= 5:
        df_day["ma5"] = df_day["close"].rolling(5).mean()
        ma5 = df_day["ma5"].iloc[-1]
        df_day["pre_close"] = df_day["close"].shift(1)
        df_day["zt"] = (df_day["close"] / df_day["pre_close"] >= 1.097) & (df_day["close"] == df_day["high"])
        zt_ok = df_day.tail(5)["zt"].sum() >= 1

    ma5_ok = price >= ma5 * 0.99 if ma5 != 0 else False

    # 15分钟（200根：足够EMA26预热，使MACD与三方软件一致）
    df_15 = get_sina_15min(code, 200)
    last_15_price = 0.0
    cond3 = cond4 = cond5 = cond6 = False
    
    if len(df_15) >= 2:
        last_15_price = df_15["close"].iloc[-2]
    
    if len(df_15) >= 16:
        df_15 = calc_macd(df_15)
        recent16 = df_15.tail(16)
        cond3 = ((recent16["MACD"].shift(1) < 0) & (recent16["MACD"] >= 0)).sum() >= 1
        cond4 = ((recent16["DIF"].shift(1) < recent16["DEA"].shift(1)) & (recent16["DIF"] > recent16["DEA"])).sum() >= 1
        curr_dif = df_15["DIF"].iloc[-1]
        cond5 = -0.05 < curr_dif < 0.1
        cond6 = curr_dif > df_15["DEA"].iloc[-1]

    # all_ok = zt_ok and ma5_ok and cond3 and cond4 and cond5 and cond6  /*2026.04.23临时调试*/
    all_ok = ma5_ok and cond3 and cond4 and cond5 and cond6
    return all_ok, round(price,2), round(ma5,2), len(df_day), len(df_15), round(last_15_price,2)

# ======================== 主程序 ========================
if __name__ == "__main__":
    print("=" * 130)
    print("📈 最终完整版｜价格+MA5+日线K数+15分钟K数+上一根15分钟价")
    print("=" * 130)
    print(f"{'时间':<18} {'代码':<8} {'状态':<10} {'价格':<10} {'MA5':<10} {'日线K数':<10} {'15分钟K数':<12} {'上一根15分钟价':<12}")
    print("-" * 130)

    result_list = []  # 保存最终入选代码
    for idx, code in enumerate(STOCKS):
        ok, price, ma5, day_cnt, min15_cnt, last15 = check(code)
        now = datetime.datetime.now().strftime("%m-%d %H:%M:%S")
        status = "✅ 入选" if ok else "❌ 不符合"
        print(f"{now:<18} {code:<8} {status:<10} {price:<10} {ma5:<10} {day_cnt:<10} {min15_cnt:<12} {last15:<12}")

        if ok:
            result_list.append(code)

        if idx % 20 == 0 and idx > 0:
            print(f"\n--- 已处理 {idx} 只 ---\n")
        time.sleep(0.3)

    # ======================== 最终汇总输出（你要的格式） ========================
    final_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    print("\n" + "=" * 80)
    print(f"{final_time} 最终选出:")
    print("	".join(result_list) if result_list else "暂无符合条件")
    print("=" * 80)

    input("\n运行结束，按回车退出")