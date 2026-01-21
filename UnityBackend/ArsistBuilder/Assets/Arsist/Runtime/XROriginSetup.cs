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
        [Header("Camera Settings")]
        [SerializeField] private Camera _mainCamera;
        [SerializeField] private Transform _cameraOffset;
        [SerializeField] private float _defaultHeight = 1.6f;
        
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

        private void Awake()
        {
            SetupCamera();
            SetupInteraction();
        }

        private void Start()
        {
            StartCoroutine(InitializeXR());
        }

        private IEnumerator InitializeXR()
        {
            // XRの初期化を待つ
            yield return new WaitForSeconds(0.5f);
            
            var xrDisplaySubsystems = new List<XRDisplaySubsystem>();
            SubsystemManager.GetInstances(xrDisplaySubsystems);
            
            if (xrDisplaySubsystems.Count > 0)
            {
                Debug.Log("[Arsist] XR Display initialized");
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
                _mainCamera.clearFlags = CameraClearFlags.SolidColor;
                // XREAL: 黒(RGB0)を透過扱い。alpha=0の黒に揃える。
                _mainCamera.backgroundColor = new Color(0f, 0f, 0f, 0f);
                _mainCamera.nearClipPlane = 0.1f;
                _mainCamera.farClipPlane = 100f;

                // AR Foundation の ARCameraBackground が付いていると視界が塗りつぶされることがあるため除去
                // （パッケージが無い場合もあるので、型名で安全に取得する）
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

            if (inputDevices.Count > 0)
            {
                var controller = inputDevices[0];
                
                if (controller.TryGetFeatureValue(CommonUsages.devicePosition, out Vector3 pos) &&
                    controller.TryGetFeatureValue(CommonUsages.deviceRotation, out Quaternion rot))
                {
                    _rayLine.enabled = true;
                    
                    var startPos = pos;
                    var direction = rot * Vector3.forward;
                    var endPos = startPos + direction * 10f;
                    
                    if (Physics.Raycast(startPos, direction, out RaycastHit hit, 10f))
                    {
                        endPos = hit.point;
                    }
                    
                    _rayLine.SetPosition(0, startPos);
                    _rayLine.SetPosition(1, endPos);
                }
                else
                {
                    _rayLine.enabled = false;
                }
            }
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
