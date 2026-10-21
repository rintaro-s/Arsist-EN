using Arsist.Runtime.DataFlow;
using Jint.Native;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// スクリプト上の store オブジェクト (store.get / store.set / …)。
    ///
    /// **これはアプリで 1 つの入れ物 (ArsistDataStore) の窓口**であって、スクリプト専用の
    /// 置き場ではない。同じ名前を、UI の bind・キーボード・認識タスクが読み書きしている:
    ///
    ///   キーボード / 入力欄  --書く-->  ArsistDataStore  --読む-->  スクリプト (store.get)
    ///   スクリプト (store.set) --書く-->  ArsistDataStore  --読む-->  UI の bind (ArsistUIBinding)
    ///   認識タスク           --書く-->  ArsistDataStore  --読む-->  両方
    ///
    /// 以前はここが**自前の Dictionary** を持っていた。そのため
    ///   - スクリプトが store.get('chat.input') しても、キーボードが打った文字は見えず
    ///   - スクリプトが store.set('chat.answer', …) しても、UI には何も出ない
    /// という状態だった。実機では「確定しても一切反応が無い」ようにしか見えない
    /// (2026-09 に踏んだ)。書く側と読む側は必ず同じ入れ物を指すこと。
    ///
    /// 値の受け渡し (2026-10):
    ///   - 配列・オブジェクトは「素の木」(Dictionary / List / double / string / bool) にしてから入れる。
    ///     Jint は JS のオブジェクトを ExpandoObject で渡してくるので、そのまま入れると
    ///     後から JS 側で元のオブジェクトを書き換えたときにストアの中身まで黙って変わる
    ///     (UI にも端末の保存にも知らせが行かない)。
    ///   - 読むときは本物の JS の値にして返す (JSON.parse)。CLR の List をそのまま返すと
    ///     JS では配列に見えない (Array.isArray が false、map / push が無い)。端末から読み戻した値と
    ///     認識タスクが書いた辞書も、こうしないと使えない。返すのは写しなので、書き換えたら store.set し直す。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class StoreWrapper
    {
        private static ArsistDataStore Store => ArsistDataStore.Instance;
        private readonly JsBridge _js;

        public StoreWrapper(JsBridge js)
        {
            _js = js;
        }

        [UnityEngine.Scripting.Preserve]
        public JsValue get(string key)
        {
            if (string.IsNullOrEmpty(key)) return JsValue.Null;
            // ドットは「そのままの名前」でも「入れ子」でも引ける (ArsistDataStore を参照)
            return Store.TryGetValueByPath(key, out var value) ? _js.ToJs(value) : JsValue.Null;
        }

        [UnityEngine.Scripting.Preserve]
        public void set(string key, JsValue value)
        {
            if (string.IsNullOrEmpty(key)) return;
            // SetValue は OnValueChanged を鳴らすので、bind している UI がその場で追従する
            Store.SetValue(key, _js.FromJs(value));
        }

        [UnityEngine.Scripting.Preserve]
        public bool has(string key)
        {
            if (string.IsNullOrEmpty(key)) return false;
            return Store.TryGetValueByPath(key, out _);
        }

        [UnityEngine.Scripting.Preserve]
        public void remove(string key)
        {
            if (string.IsNullOrEmpty(key)) return;
            Store.RemoveValue(key);
        }

        [UnityEngine.Scripting.Preserve]
        public void clear()
        {
            Store.Clear();
        }
    }
}
