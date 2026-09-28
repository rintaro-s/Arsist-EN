// アプリの中で値を受け渡す入れ物 (ArsistDataStore) の検証。
//
// ここは「キーボードが打った文字」「スクリプトが書いた答え」「認識タスクの結果」が
// すべて集まる場所で、**書く側と読む側で名前の扱いが食い違うと何も動かない**。
// 実機では「打っても入力欄に出ない」「確定しても応答が無い」という形でしか見えず、
// 原因を追うのに時間がかかった (2026-09)。ここで固定しておく。
using System;
using System.Collections.Generic;
using Arsist.Runtime.DataFlow;

internal static class DataStoreChecks
{
    private static int _failures;

    private static void Expect(string label, bool ok, string detail = null)
    {
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {label}{(detail != null ? $": {detail}" : "")}");
        if (!ok) _failures++;
    }

    private static void TestDottedNameIsReadableAsWritten()
    {
        var store = ArsistDataStore.Instance;
        store.Clear();

        // キーボードや script が書くのはこの形 ("chat.input" という 1 つの名前)
        store.SetValue("chat.input", "こんにちは");

        Expect("a dotted name reads back by path", store.TryGetValueByPath("chat.input", out var value) && (string)value == "こんにちは");
        Expect("the same name reads back flat", (string)store.GetValue("chat.input") == "こんにちは");
        Expect("a name that was never set is not found", !store.TryGetValueByPath("chat.missing", out _));
    }

    private static void TestNestedDictionaryStillWalks()
    {
        var store = ArsistDataStore.Instance;
        store.Clear();

        // 認識タスクは辞書ごと書く。こちらは入れ子として辿れなければならない
        store.SetValue("ocr", new Dictionary<string, object>
        {
            ["text"] = "SALE",
            ["items"] = new List<object> { new Dictionary<string, object> { ["x"] = 0.25 } },
        });

        Expect("nested key walks", store.TryGetValueByPath("ocr.text", out var text) && (string)text == "SALE");
        Expect("array index walks", store.TryGetValueByPath("ocr.items[0].x", out var x) && (double)x == 0.25);
        Expect("array index with a dot walks", store.TryGetValueByPath("ocr.items.0.x", out var x2) && (double)x2 == 0.25);
        Expect("a missing branch is not found", !store.TryGetValueByPath("ocr.nothing.here", out _));
    }

    private static void TestEmptyIsNotTheSameAsMissing()
    {
        var store = ArsistDataStore.Instance;
        store.Clear();

        Expect("missing is reported as missing", !store.TryGetValueByPath("chat.input", out _));
        store.SetValue("chat.input", "");
        Expect("empty is reported as present", store.TryGetValueByPath("chat.input", out var value) && (string)value == "");
    }

    private static void TestChangesAreAnnounced()
    {
        var store = ArsistDataStore.Instance;
        store.Clear();

        var seen = new List<string>();
        Action<string, object> listener = (key, _) => seen.Add(key);
        store.OnValueChanged += listener;
        try
        {
            store.SetValue("chat.answer", "はい");
            store.RemoveValue("chat.answer");
            store.SetValue("a", 1);
            store.Clear();
        }
        finally
        {
            store.OnValueChanged -= listener;
        }

        Expect("set is announced", seen.Contains("chat.answer"));
        Expect("remove is announced", seen.FindAll(k => k == "chat.answer").Count == 2);
        Expect("clear is announced", seen.Contains("a") && seen.Count == 4, string.Join(",", seen));
    }

    public static int Run()
    {
        Console.WriteLine("\n== data store ==");
        _failures = 0;
        TestDottedNameIsReadableAsWritten();
        TestNestedDictionaryStillWalks();
        TestEmptyIsNotTheSameAsMissing();
        TestChangesAreAnnounced();
        ArsistDataStore.Instance.Clear();
        return _failures;
    }
}
