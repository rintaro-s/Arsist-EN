using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;

namespace Arsist.Runtime.Input
{
    /// <summary>
    /// 視線カーソル（Gaze）入力システム
    /// ユーザーの視線の中心にあるオブジェクトを検出し、イベントを発火
    /// </summary>
    public class ArsistGazeInput : MonoBehaviour
    {
        public static ArsistGazeInput Instance { get; private set; }

        [Header("Gaze Settings")]
        [Tooltip("視線の最大検出距離")]
        [SerializeField] private float maxDistance = 100f;
        
        [Tooltip("視線カーソルのビジュアル（オプション）")]
        [SerializeField] private GameObject gazeCursorPrefab;
        
        [Tooltip("視線がオブジェクトに留まった時間で「選択」と判定する秒数（0で無効）")]
        [SerializeField] private float dwellTimeToSelect = 0f;

        [Header("Debug")]
        [SerializeField] private bool showDebugRay = false;

        // 現在視線が当たっているオブジェクト
        public GameObject CurrentTarget { get; private set; }
        public Vector3 CurrentHitPoint { get; private set; }
        public float CurrentDwellTime { get; private set; }

        // イベント
        public event Action<GameObject, Vector3> OnGazeEnter;
        public event Action<GameObject> OnGazeExit;
        public event Action<GameObject, Vector3> OnGazeStay;
        public event Action<GameObject, Vector3> OnGazeDwellSelect;

        private Camera _mainCamera;
        private GameObject _gazeCursor;
        private GameObject _previousTarget;
        private float _dwellTimer;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
        }

        private void Start()
        {
            _mainCamera = Camera.main;
            if (_mainCamera == null)
            {
                Debug.LogError("[ArsistGazeInput] Main Camera not found!");
                enabled = false;
                return;
            }

            if (gazeCursorPrefab != null)
            {
                _gazeCursor = Instantiate(gazeCursorPrefab);
                _gazeCursor.SetActive(false);
            }
        }

        private void Update()
        {
            if (_mainCamera == null) return;

            PerformGazeRaycast();
        }

        private void PerformGazeRaycast()
        {
            var ray = new Ray(_mainCamera.transform.position, _mainCamera.transform.forward);
            
            if (showDebugRay)
            {
                Debug.DrawRay(ray.origin, ray.direction * maxDistance, Color.cyan);
            }

            // 当たり判定は 3D の物と UI の両方 (UI をコライダー任せにすると、大きさが後から
            // 決まる要素で素通りする)。視線・コントローラー・手で同じ判定を使う ―
            // 端末ごとに入り口が違うだけで、押せる/押せないが変わってはいけない。
            if (UI.ArsistUiPointer.RaycastScene(ray, maxDistance, out var hitTarget, out var hitPoint))
            {
                CurrentTarget = hitTarget;
                CurrentHitPoint = hitPoint;

                // カーソル更新
                if (_gazeCursor != null)
                {
                    _gazeCursor.SetActive(true);
                    _gazeCursor.transform.position = hitPoint;
                    _gazeCursor.transform.rotation = Quaternion.LookRotation(ray.direction);
                }

                // Enter/Exit判定
                if (CurrentTarget != _previousTarget)
                {
                    if (_previousTarget != null)
                    {
                        OnGazeExit?.Invoke(_previousTarget);
                        SendGazeMessage(_previousTarget, "OnGazeExit");
                    }

                    OnGazeEnter?.Invoke(CurrentTarget, hitPoint);
                    SendGazeMessage(CurrentTarget, "OnGazeEnter", hitPoint);
                    
                    _dwellTimer = 0f;
                }
                else
                {
                    // Stay
                    OnGazeStay?.Invoke(CurrentTarget, hitPoint);
                    
                    // Dwell選択
                    if (dwellTimeToSelect > 0)
                    {
                        _dwellTimer += Time.deltaTime;
                        CurrentDwellTime = _dwellTimer;
                        
                        if (_dwellTimer >= dwellTimeToSelect)
                        {
                            OnGazeDwellSelect?.Invoke(CurrentTarget, hitPoint);
                            SendGazeMessage(CurrentTarget, "OnGazeDwellSelect", hitPoint);
                            _dwellTimer = 0f; // リセット（連続発火防止）
                        }
                    }
                }

                _previousTarget = CurrentTarget;
            }
            else
            {
                // 何もヒットしない
                if (_gazeCursor != null)
                {
                    _gazeCursor.SetActive(false);
                }

                if (_previousTarget != null)
                {
                    OnGazeExit?.Invoke(_previousTarget);
                    SendGazeMessage(_previousTarget, "OnGazeExit");
                }

                CurrentTarget = null;
                CurrentHitPoint = Vector3.zero;
                CurrentDwellTime = 0f;
                _dwellTimer = 0f;
                _previousTarget = null;
            }
        }

        private void SendGazeMessage(GameObject target, string methodName, Vector3? hitPoint = null)
        {
            if (target == null) return;

            // SendMessageを使ってオブジェクトにイベント通知
            if (hitPoint.HasValue)
            {
                target.SendMessage(methodName, hitPoint.Value, SendMessageOptions.DontRequireReceiver);
            }
            else
            {
                target.SendMessage(methodName, SendMessageOptions.DontRequireReceiver);
            }
        }

        private void OnDestroy()
        {
            if (Instance == this) Instance = null;
            if (_gazeCursor != null) Destroy(_gazeCursor);
        }
    }
}
