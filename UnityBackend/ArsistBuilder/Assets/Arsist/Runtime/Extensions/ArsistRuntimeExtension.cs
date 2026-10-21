// ==============================================
// Arsist Engine - Extensions: runtime entry point
// Assets/Arsist/Runtime/Extensions/ArsistRuntimeExtension.cs
//
// 拡張機能 (Extensions/<id>/) が実機で動くときの入口。
// 拡張機能はこのクラスを継承したクラスを 1 つ持ち、extension.json の unity.entry にその完全名を書く。
// ビルドがそのクラスを `new` する登録コード (ArsistExtensionRegistry.g.cs) を生成するので、
// リフレクションも IL2CPP の型探しも要らない。
//
// 呼ばれる順:
//   1. RegisterScriptGlobals  スクリプトエンジンの初期化中 (Awake)。ここで `room` などの名前を出す。
//                             スクリプトを使わないプロジェクトでは呼ばれない。
//   2. OnStart                シーンが始まって最初の Start。部屋を読む・物を置く等はここから。
//   (ReplaceEngineParts       エンジンが置き換えられる部品を初めて使う直前。replaces を書いた拡張機能だけ)
//
// どちらもメインスレッド。Jint もメインスレッドでしか触れないので、別スレッドで得た結果を
// スクリプトに返すときは、メインスレッドに戻してから ArsistScriptBridge.Call を呼ぶこと。
// 詳しくは doc/17-extensions.md。
// ==============================================

namespace Arsist.Runtime.Extensions
{
    [UnityEngine.Scripting.Preserve]
    public abstract class ArsistRuntimeExtension
    {
        /// <summary>extension.json の id と同じ文字列。</summary>
        public abstract string Id { get; }

        /// <summary>
        /// スクリプトに名前を出す。extension.json の script.globals に書いた名前だけを使うこと
        /// (組み込みの名前や他の拡張機能の名前とぶつかると、Set が断ってログに出す)。
        /// </summary>
        public virtual void RegisterScriptGlobals(ArsistScriptBridge script, ArsistExtensionContext context) { }

        /// <summary>
        /// エンジンの部品を置き換える (extension.json の replaces に書いたものだけ)。
        /// エンジンが置き換えられる部品を最初に使う前に 1 回呼ばれる (シーンの Start より前のこともある。
        /// context.Host はまだ無い)。組み込みのスクリプトの名前は RegisterScriptGlobals で Set する。
        /// </summary>
        public virtual void ReplaceEngineParts(ArsistEngineParts.Replacer parts, ArsistExtensionContext context) { }

        /// <summary>シーンが始まったら 1 回だけ呼ばれる。</summary>
        public virtual void OnStart(ArsistExtensionContext context) { }
    }
}
