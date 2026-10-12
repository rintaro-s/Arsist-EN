// ==============================================
// Arsist Engine - 端末に保存する値の置き場 (置き換えられる部品)
// Assets/Arsist/Runtime/Data/IArsistStorageBackend.cs
//
// project.storage.persist の値を「どこに」書くか。拡張機能が置き換えられる部品
// (ArsistEngineParts.StorageBackend = "storage-backend")。エンジン標準は端末の中のファイル 1 つ
// (ArsistFileStorageBackend)。何を・いつ書くかは ArsistPersistentStore が決め、ここは文字列を読み書きするだけ。
// 呼ばれるのはメインスレッド。重い処理 (通信など) をするなら、Write は手元に置いてから裏で送ること。
// ==============================================

using System;
using System.IO;

namespace Arsist.Runtime.Data
{
    public interface IArsistStorageBackend
    {
        /// <summary>ログに出す名前 (ファイルのパス・送り先など)。</summary>
        string Name { get; }

        /// <summary>前に保存した中身。まだ何も無ければ null。読めなければ例外。</summary>
        string Read();

        /// <summary>中身を丸ごと置き換える。途中で止まっても前の中身が残るようにする。</summary>
        void Write(string text);

        /// <summary>読めなかった中身を、消さずに脇へ置く (後で調べられるように)。できなければ何もしない。</summary>
        void KeepUnreadable(string text);
    }

    /// <summary>
    /// エンジン標準: 1 つのファイル。一時ファイルに書いてから差し替える。
    /// UnityEngine に依存しない (npm run test:perception が確かめる)。
    /// </summary>
    public sealed class ArsistFileStorageBackend : IArsistStorageBackend
    {
        private readonly string _path;

        public ArsistFileStorageBackend(string path)
        {
            _path = path;
        }

        public string Name => _path;

        public string Read() => File.Exists(_path) ? File.ReadAllText(_path) : null;

        public void Write(string text)
        {
            var temp = _path + ".tmp";
            File.WriteAllText(temp, text);
            if (File.Exists(_path))
            {
                try { File.Replace(temp, _path, null); }
                catch (Exception)
                {
                    // File.Replace が使えないファイルシステムでは消してから移す
                    File.Delete(_path);
                    File.Move(temp, _path);
                }
            }
            else
            {
                File.Move(temp, _path);
            }
        }

        public void KeepUnreadable(string text)
        {
            try { File.WriteAllText(_path + ".broken", text ?? ""); } catch (Exception) { }
        }
    }
}
