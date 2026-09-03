// ==============================================
// Arsist Engine - XR Origin Component
// UnityBackend/ArsistBuilder/Assets/Arsist/Runtime/XROriginSetup.cs
// ==============================================

using UnityEngine;
using UnityEngine.XR;
using UnityEngine.XR.Interaction.Toolkit;
using System.Collections;
using System.Collections.Generic;

namespace Arsist.Runtime
{
    /// <summary>
    /// ARシーン用のXR Origin設定コンポーネント
    /// Arsistで生成されたシーンに自動追加される
    /// </summary>
    public class XROriginSetup : MonoBehaviour
    {
        /// <summary>背景の描き方。ArsistBuildPipeline がビルド時に arSettings.backgroundMode から設定する。</summary>
        public enum BackgroundMode
        {
            /// <summary>透過（光学シースルー / Quest のパススルー）。カメラは alpha=0 の黒でクリアする。</summary>
            Passthrough = 0,
            /// <summary>Skybox を背景に描く（VR）。</summary>
            Skybox = 1,
            /// <summary>単色で塗りつぶす（VR）。</summary>
            SolidColor = 2,
        }

        [Header("Camera Settings")]
        [SerializeField] private Camera _mainCamera;
        [SerializeField] private Transform _cameraOffset;
        [SerializeField] private float _defaultHeight = 1.6f;

        [Tooltip("背景の描き方。ビルド時に arSettings.backgroundMode から設定される。")]
        [SerializeField] private BackgroundMode _backgroundMode = BackgroundMode.Passthrough;
        [Tooltip("_backgroundMode = SolidColor のときの背景色。")]
        [SerializeField] private Color _backgroundColor = Color.black;
        
        [Header("Interaction")]
        [SerializeField] private bool _enableGazeInteraction = true;
        [SerializeField] private bool _enableRayInteraction = true;
        [SerializeField] private float _gazeActivationTime = 1.5f;
        
        [Header("Visual Feedback")]
        [SerializeField] private GameObject _gazeCursor;
        [SerializeField] private LineRenderer _rayLine;
        [SerializeField] private Color _rayColor = new Color(0.91f, 0.27f, 0.38f, 0.8f);
        
        private bool _isTracking = false;
        private Vector3 _lastHeadPosition;
        private Quaternion _lastHeadRotation;

        // コントローラーレイの選択状態（Enter/Exit と トリガー立ち上がりでの決定を検出するため）
        private GameObject _rayCurrentTarget;
        private bool _rayTriggerWasPressed;

        [Header("Performance")]
        [Tooltip("ARグラス側のリフレッシュレートに合わせた目標フレームレート。0以下で未設定。")]
        [SerializeField] private int _targetFrameRate = 60;

        private void Awake()
        {
            ApplyFrameRateSettings();
            SetupCamera();
            SetupInteraction();
        }

        /// <summary>
        /// Application.targetFrameRate はランタイムでしか効かないため、ここで適用する。
        /// (以前は XrealBuildPatcher がビルド時に設定していたが、APKには反映されていなかった)
        /// </summary>
        private void ApplyFrameRateSettings()
        {
            if (_targetFrameRate <= 0) return;
            QualitySettings.vSyncCount = 0;
            Application.targetFrameRate = _targetFrameRate;
        }

        private void Start()
        {
            StartCoroutine(InitializeXR());
        }

        [Header("XR Initialization")]
        [Tooltip("XRディスプレイの起動を待つ最大秒数。XREAL SDKの初期化は環境により遅れるため固定待ちにしない。")]
        [SerializeField] private float _xrInitTimeoutSeconds = 8f;

        private IEnumerator InitializeXR()
        {
            // XRディスプレイが「running」になるまでポーリングする。
            // 以前は固定 WaitForSeconds(0.5f) で判定しており、XREAL SDK の初期化が
            // 遅い環境ではまだ起動していないのにフォールバック（マウス操作）へ落ちて
            // 「トラッキングが効かない」ように見える誤発火の原因になっていた。
            var xrDisplaySubsystems = new List<XRDisplaySubsystem>();
            float elapsed = 0f;

            while (elapsed < _xrInitTimeoutSeconds)
            {
                xrDisplaySubsystems.Clear();
                SubsystemManager.GetInstances(xrDisplaySubsystems);

                bool running = false;
                foreach (var ds in xrDisplaySubsystems)
                {
                    if (ds != null && ds.running)
                    {
                        running = true;
                        break;
                    }
                }

                if (running)
                {
                    Debug.Log($"[Arsist] XR Display initialized after {elapsed:F1}s");
                    _isTracking = true;
                    yield break;
                }

                elapsed += Time.unscaledDeltaTime;
                yield return null;
            }

            // タイムアウト: それでも見つかった（=生成はされたがまだrunningでない）なら
            // トラッキング扱いにし、完全に無ければフォールバックへ。
            if (xrDisplaySubsystems.Count > 0)
            {
                Debug.LogWarning($"[Arsist] XR Display present but not running after {_xrInitTimeoutSeconds:F0}s; continuing in XR mode");
                _isTracking = true;
            }
            else
            {
                Debug.LogWarning("[Arsist] No XR Display found, using fallback mode");
                SetupFallbackMode();
            }
        }

        private void SetupCamera()
        {
            if (_mainCamera == null)
            {
                _mainCamera = Camera.main;
                if (_mainCamera == null)
                {
                    _mainCamera = GetComponentInChildren<Camera>();
                }
            }

            if (_mainCamera != null)
            {
                // AR用カメラ設定
                if (_mainCamera.tag != "MainCamera")
                {
                    _mainCamera.tag = "MainCamera";
                }
                ApplyBackground(_mainCamera);
                _mainCamera.nearClipPlane = 0.1f;
                _mainCamera.farClipPlane = 100f;

                // AR Foundation の ARCameraBackground が付いていると視界が塗りつぶされることがあるため除去
                // （パッケージが無い場合もあるので、型名で安全に取得する）
                // VR 背景（Skybox / SolidColor）でも、AR 用のカメラ映像描画は不要なので同じく外す。
                var arCameraBackground = _mainCamera.GetComponent("UnityEngine.XR.ARFoundation.ARCameraBackground");
                if (arCameraBackground != null)
                {
                    Destroy(arCameraBackground);
                }
            }

            if (_cameraOffset == null)
            {
                _cameraOffset = transform.Find("Camera Offset");
                if (_cameraOffset == null && _mainCamera != null)
                {
                    _cameraOffset = _mainCamera.transform.parent;
                }
            }
        }

        /// <summary>
        /// 背景（カメラの clear）を _backgroundMode に従って設定する。
        ///
        /// 以前はここで無条件に alpha=0 の黒クリアを強制していたため、ビルド時に
        /// Skybox / 単色を選んでもランタイムで上書きされて必ず透過になっていた。
        /// </summary>
        private void ApplyBackground(Camera cam)
        {
            switch (_backgroundMode)
            {
                case BackgroundMode.Skybox:
                    cam.clearFlags = CameraClearFlags.Skybox;
                    break;

                case BackgroundMode.SolidColor:
                    cam.clearFlags = CameraClearFlags.SolidColor;
                    // VR 背景は不透過。alpha を落とすと Quest 側で素通しになってしまう。
                    cam.backgroundColor = new Color(_backgroundColor.r, _backgroundColor.g, _backgroundColor.b, 1f);
                    break;

                default:
                    cam.clearFlags = CameraClearFlags.SolidColor;
                    // 光学シースルー(XREAL)は黒(RGB0)がそのまま透過。
                    // Quest のパススルーも、アンダーレイ合成のために alpha=0 の黒が必要。
                    cam.backgroundColor = new Color(0f, 0f, 0f, 0f);
                    break;
            }
        }

        private void SetupInteraction()
        {
            if (_enableGazeInteraction)
            {
                SetupGazeInteraction();
            }

            if (_enableRayInteraction)
            {
                SetupRayInteraction();
            }
        }

        private void SetupGazeInteraction()
        {
            if (_gazeCursor == null && _mainCamera != null)
            {
                // 視線カーソルを作成
                _gazeCursor = CreateGazeCursor();
                _gazeCursor.transform.SetParent(_mainCamera.transform);
                _gazeCursor.transform.localPosition = new Vector3(0, 0, 2f);
                _gazeCursor.SetActive(false);
            }
        }

        private GameObject CreateGazeCursor()
        {
            var cursor = new GameObject("GazeCursor");
            
            // リングカーソル
            var ring = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            ring.transform.SetParent(cursor.transform);
            ring.transform.localScale = new Vector3(0.05f, 0.001f, 0.05f);
            
            var ringShader = FindSafeShader(new[] { "Unlit/Color", "Universal Render Pipeline/Unlit", "Sprites/Default" });
            if (ringShader != null)
            {
                var ringMat = new Material(ringShader);
                ringMat.color = _rayColor;
                ring.GetComponent<Renderer>().material = ringMat;
            }
            else
            {
                Debug.LogWarning("[XROriginSetup] No compatible shader found for gaze cursor.");
            }
            
            // コライダー不要
            Destroy(ring.GetComponent<Collider>());

            return cursor;
        }

        private void SetupRayInteraction()
        {
            if (_rayLine == null)
            {
                var rayObj = transform.Find("Ray Interactor");
                if (rayObj != null)
                {
                    _rayLine = rayObj.GetComponent<LineRenderer>();
                }
                
                if (_rayLine == null)
                {
                    var newRayObj = new GameObject("Ray Interactor");
                    newRayObj.transform.SetParent(transform);
                    _rayLine = newRayObj.AddComponent<LineRenderer>();
                }
            }

            if (_rayLine != null)
            {
                _rayLine.startWidth = 0.005f;
                _rayLine.endWidth = 0.005f;
                _rayLine.positionCount = 2;
                
                var rayShader = FindSafeShader(new[] { "Unlit/Color", "Universal Render Pipeline/Unlit", "Sprites/Default" });
                if (rayShader != null)
                {
                    var rayMat = new Material(rayShader);
                    rayMat.color = _rayColor;
                    _rayLine.material = rayMat;
                }
                else
                {
                    Debug.LogWarning("[XROriginSetup] No compatible shader found for ray.");
                }
                _rayLine.enabled = false;
            }
        }

        private static Shader FindSafeShader(string[] candidates)
        {
            foreach (var name in candidates)
            {
                if (string.IsNullOrWhiteSpace(name)) continue;
                var s = Shader.Find(name);
                if (s != null) return s;
            }
            return null;
        }

        private void SetupFallbackMode()
        {
            // エディタ/非XR環境用のフォールバック
            if (_cameraOffset != null)
            {
                _cameraOffset.localPosition = new Vector3(0, _defaultHeight, 0);
            }
            
            // マウスルック有効化
            var mouseLook = _mainCamera?.gameObject.AddComponent<FallbackMouseLook>();
            if (mouseLook != null)
            {
                mouseLook.sensitivity = 2f;
            }
        }

        private void Update()
        {
            if (!_isTracking) return;

            UpdateTrackingState();
            UpdateInteraction();
        }

        private void UpdateTrackingState()
        {
            // ヘッドトラッキング状態を監視
            var inputDevices = new List<InputDevice>();
            InputDevices.GetDevicesAtXRNode(XRNode.Head, inputDevices);

            if (inputDevices.Count > 0)
            {
                var headDevice = inputDevices[0];
                
                if (headDevice.TryGetFeatureValue(CommonUsages.devicePosition, out Vector3 position))
                {
                    _lastHeadPosition = position;
                }
                
                if (headDevice.TryGetFeatureValue(CommonUsages.deviceRotation, out Quaternion rotation))
                {
                    _lastHeadRotation = rotation;
                }
            }
        }

        private void UpdateInteraction()
        {
            if (_enableGazeInteraction && _gazeCursor != null)
            {
                UpdateGazeInteraction();
            }

            if (_enableRayInteraction && _rayLine != null)
            {
                UpdateRayInteraction();
            }
        }

        private void UpdateGazeInteraction()
        {
            // 視線レイキャスト
            var ray = new Ray(_mainCamera.transform.position, _mainCamera.transform.forward);
            
            if (Physics.Raycast(ray, out RaycastHit hit, 10f))
            {
                _gazeCursor.SetActive(true);
                _gazeCursor.transform.position = hit.point;
                _gazeCursor.transform.rotation = Quaternion.LookRotation(hit.normal);

                // 視線ヒット時の視覚的フィードバック
                _gazeCursor.transform.localScale = Vector3.one * 1.2f;
            }
            else
            {
                _gazeCursor.SetActive(false);
            }
        }

        private void UpdateRayInteraction()
        {
            // コントローラーからのレイ
            var inputDevices = new List<InputDevice>();
            InputDevices.GetDevicesWithCharacteristics(InputDeviceCharacteristics.Controller, inputDevices);

            if (inputDevices.Count == 0)
            {
                _rayLine.enabled = false;
                ReleaseRayTarget();
                return;
            }

            var controller = inputDevices[0];

            if (!controller.TryGetFeatureValue(CommonUsages.devicePosition, out Vector3 pos) ||
                !controller.TryGetFeatureValue(CommonUsages.deviceRotation, out Quaternion rot))
            {
                _rayLine.enabled = false;
                ReleaseRayTarget();
                return;
            }

            _rayLine.enabled = true;

            var startPos = pos;
            var direction = rot * Vector3.forward;
            var endPos = startPos + direction * 10f;

            GameObject hitTarget = null;
            Vector3 hitPoint = default;
            if (Physics.Raycast(startPos, direction, out RaycastHit hit, 10f))
            {
                endPos = hit.point;
                hitPoint = hit.point;
                hitTarget = hit.collider.gameObject;
            }

            _rayLine.SetPosition(0, startPos);
            _rayLine.SetPosition(1, endPos);

            // Enter/Exit 通知（ArsistGazeTarget と同じ SendMessage を再利用。
            // 視線・コントローラーレイ・ハンドトラッキングのどれでも同じ IR ロジックが動く）
            if (hitTarget != _rayCurrentTarget)
            {
                if (_rayCurrentTarget != null)
                {
                    _rayCurrentTarget.SendMessage("OnGazeExit", SendMessageOptions.DontRequireReceiver);
                }
                _rayCurrentTarget = hitTarget;
                if (_rayCurrentTarget != null)
                {
                    _rayCurrentTarget.SendMessage("OnGazeEnter", hitPoint, SendMessageOptions.DontRequireReceiver);
                }
            }

            // トリガーの立ち上がりだけを「決定」として送る（押しっぱなしで連打しない）
            var triggerPressed = controller.TryGetFeatureValue(CommonUsages.triggerButton, out bool trigger) && trigger;
            if (triggerPressed && !_rayTriggerWasPressed && _rayCurrentTarget != null)
            {
                _rayCurrentTarget.SendMessage("OnGazeDwellSelect", hitPoint, SendMessageOptions.DontRequireReceiver);
            }
            // 押し続けている間は毎フレーム送る（Slider を掴んでドラッグする用途。
            // Button 等 OnGazeDrag を実装しないターゲットには何も起きない）
            if (triggerPressed && _rayCurrentTarget != null)
            {
                _rayCurrentTarget.SendMessage("OnGazeDrag", hitPoint, SendMessageOptions.DontRequireReceiver);
            }
            _rayTriggerWasPressed = triggerPressed;
        }

        private void ReleaseRayTarget()
        {
            if (_rayCurrentTarget == null) return;
            _rayCurrentTarget.SendMessage("OnGazeExit", SendMessageOptions.DontRequireReceiver);
            _rayCurrentTarget = null;
            _rayTriggerWasPressed = false;
        }

        /// <summary>
        /// カメラの初期位置をリセット
        /// </summary>
        public void RecenterCamera()
        {
            if (_cameraOffset != null)
            {
                var headPos = _mainCamera.transform.localPosition;
                _cameraOffset.localPosition -= new Vector3(headPos.x, 0, headPos.z);
            }
            
            Debug.Log("[Arsist] Camera recentered");
        }

        /// <summary>
        /// トラッキング状態を取得
        /// </summary>
        public bool IsTracking => _isTracking;

        /// <summary>
        /// ヘッドの位置を取得
        /// </summary>
        public Vector3 HeadPosition => _lastHeadPosition;

        /// <summary>
        /// ヘッドの回転を取得
        /// </summary>
        public Quaternion HeadRotation => _lastHeadRotation;
    }

    /// <summary>
    /// 非XR環境用のマウスルック
    /// </summary>
    public class FallbackMouseLook : MonoBehaviour
    {
        public float sensitivity = 2f;
        
        private float _rotationX = 0f;
        private float _rotationY = 0f;

        private void Update()
        {
            if (UnityEngine.Input.GetMouseButton(1)) // 右クリックでルック
            {
                _rotationX += UnityEngine.Input.GetAxis("Mouse X") * sensitivity;
                _rotationY -= UnityEngine.Input.GetAxis("Mouse Y") * sensitivity;
                _rotationY = Mathf.Clamp(_rotationY, -90f, 90f);
                
                transform.localEulerAngles = new Vector3(_rotationY, _rotationX, 0);
            }
            
            // WASD移動
            float h = UnityEngine.Input.GetAxis("Horizontal");
            float v = UnityEngine.Input.GetAxis("Vertical");
            
            if (h != 0 || v != 0)
            {
                var move = transform.forward * v + transform.right * h;
                transform.parent.position += move * Time.deltaTime * 2f;
            }
        }
    }
}
