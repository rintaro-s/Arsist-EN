using UnityEngine;
using UnityEngine.UI;
using TMPro;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// JS から UI要素を操作するためのラッパー。
    /// UI要素は UiBindingRegistry に登録された ID で識別される。
    /// 使用例 (JS):
    ///   ui.setText('myText', 'Hello World');
    ///   ui.setVisibility('myPanel', false);
    ///   ui.setColor('myText', '#FF0000');
    ///   ui.setAlpha('myPanel', 0.5);
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class UiWrapper
    {
        /// <summary>テキスト要素の内容を変更する</summary>
        [UnityEngine.Scripting.Preserve]
        public void setText(string elementId, string text)
        {
            var go = UiBindingRegistry.Find(elementId);
            if (go == null)
            {
                Debug.LogWarning($"[ArsistScript/ui] 要素 '{elementId}' が見つかりません");
                return;
            }

            var tmp = go.GetComponent<TMP_Text>() ?? go.GetComponentInChildren<TMP_Text>();
            if (tmp != null) { tmp.text = text; return; }

            var legacy = go.GetComponent<Text>() ?? go.GetComponentInChildren<Text>();
            if (legacy != null) { legacy.text = text; return; }

            Debug.LogWarning($"[ArsistScript/ui] '{elementId}' にテキストコンポーネントがありません");
        }

        /// <summary>UI要素の表示/非表示を切り替える</summary>
        [UnityEngine.Scripting.Preserve]
        public void setVisibility(string elementId, bool isVisible)
        {
            var go = UiBindingRegistry.Find(elementId);
            if (go == null)
            {
                Debug.LogWarning($"[ArsistScript/ui] 要素 '{elementId}' が見つかりません");
                return;
            }
            go.SetActive(isVisible);
        }

        /// <summary>テキストまたはグラフィックの色を変更する (#RRGGBB または #RRGGBBAA)</summary>
        [UnityEngine.Scripting.Preserve]
        public void setColor(string elementId, string hexColor)
        {
            var go = UiBindingRegistry.Find(elementId);
            if (go == null)
            {
                Debug.LogWarning($"[ArsistScript/ui] 要素 '{elementId}' が見つかりません");
                return;
            }

            if (!ColorUtility.TryParseHtmlString(hexColor, out Color color))
            {
                Debug.LogWarning($"[ArsistScript/ui] 色の解析失敗: '{hexColor}'");
                return;
            }

            var tmp = go.GetComponent<TMP_Text>() ?? go.GetComponentInChildren<TMP_Text>();
            if (tmp != null) { tmp.color = color; return; }

            var graphic = go.GetComponent<Graphic>() ?? go.GetComponentInChildren<Graphic>();
            if (graphic != null) { graphic.color = color; return; }

            Debug.LogWarning($"[ArsistScript/ui] '{elementId}' にグラフィックコンポーネントがありません");
        }

        /// <summary>UI要素の透明度を設定する (0.0 = 完全透明, 1.0 = 不透明)</summary>
        [UnityEngine.Scripting.Preserve]
        public void setAlpha(string elementId, float alpha)
        {
            var go = UiBindingRegistry.Find(elementId);
            if (go == null)
            {
                Debug.LogWarning($"[ArsistScript/ui] 要素 '{elementId}' が見つかりません");
                return;
            }

            alpha = Mathf.Clamp01(alpha);

            var group = go.GetComponent<CanvasGroup>();
            if (group != null) { group.alpha = alpha; return; }

            var graphic = go.GetComponent<Graphic>() ?? go.GetComponentInChildren<Graphic>();
            if (graphic != null)
            {
                var c = graphic.color;
                graphic.color = new Color(c.r, c.g, c.b, alpha);
            }
        }

        /// <summary>3D テキスト (TextMeshPro 3D) のテキストを変更する</summary>
        [UnityEngine.Scripting.Preserve]
        public void setText3D(string elementId, string text)
        {
            var go = UiBindingRegistry.Find(elementId);
            if (go == null)
            {
                Debug.LogWarning($"[ArsistScript/ui] 要素 '{elementId}' が見つかりません");
                return;
            }

            var tmp3d = go.GetComponent<TextMeshPro>() ?? go.GetComponentInChildren<TextMeshPro>();
            if (tmp3d != null) { tmp3d.text = text; return; }

            Debug.LogWarning($"[ArsistScript/ui] '{elementId}' に TextMeshPro コンポーネントがありません");
        }
    }
}
