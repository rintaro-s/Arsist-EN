// ==============================================
// Arsist Engine - VRM: the replaceable loader
// Assets/Arsist/Runtime/VRM/IArsistVrmLoader.cs
//
// VRM の読み込みは拡張機能が置き換えられる部品 (ArsistEngineParts.VrmLoader = "vrm-loader")。
// エンジン標準 (ArsistVRMLoader) は UniVRM 0.x で VRM 0.x だけを読む。VRM 1.0 を読む拡張機能
// (Extensions/vrm10) は、ここの形で実装を渡す。
//
// 読み込んだモデルにエンジンが期待すること:
//   - ルートに人型 (isHuman) の Animator。動き・骨・腕の IK はこれを通す
//   - 表情を UniVRM の仕組み経由で付けたいなら、ルートに IArsistVrmFace を実装した部品を置く
//     (置かなければ、エンジンは UniVRM 0.x の部品 → BlendShape の直接操作の順で探す)
//   - 目を動かしたいなら IArsistVrmEyes (置かなければ頭だけが向く)
// ==============================================

using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Arsist.Runtime.VRM
{
    /// <summary>VRM のバイト列からモデルを作る。メインスレッドのコルーチンとして回る。</summary>
    public interface IArsistVrmLoader
    {
        /// <param name="data">.vrm の中身</param>
        /// <param name="source">ログ用の名前 (ファイルのパスや URL)</param>
        /// <param name="onLoaded">作ったモデルのルート。1 回だけ呼ぶ</param>
        /// <param name="onError">失敗の理由。onLoaded とどちらか 1 回だけ呼ぶ</param>
        IEnumerator Load(byte[] data, string source, Action<GameObject> onLoaded, Action<string> onError);
    }

    /// <summary>
    /// 表情。名前は UniVRM の表情名 (happy / aa / blink …) か VRM 0.x の名前 (Joy / A / Blink …)。
    /// 重さは 0..1 (エンジンの VRMExpressionController が 0..100 から直して渡す)。
    /// </summary>
    public interface IArsistVrmFace
    {
        bool SetExpression(string name, float weight01);
        void ResetExpressions();
        IReadOnlyList<string> ExpressionNames { get; }
    }

    /// <summary>目の向き。target が null なら正面に戻す。頭を向けるのはエンジン (VRMLookAtController) がやる。</summary>
    public interface IArsistVrmEyes
    {
        void LookAt(Transform target);
    }
}
