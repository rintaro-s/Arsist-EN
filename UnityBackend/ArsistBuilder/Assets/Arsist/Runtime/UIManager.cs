// ==============================================
// Arsist Engine - UI Manager
// UnityBackend/ArsistBuilder/Assets/Arsist/Runtime/UIManager.cs
// ==============================================

using UnityEngine;
using UnityEngine.UI;
using TMPro;
using System.Collections;
using System.Collections.Generic;

namespace Arsist.Runtime
{
    /// <summary>
    /// ArsistアプリのUI管理コンポーネント
    /// World Space UIの表示・非表示・アニメーションを制御
    /// </summary>
    public class UIManager : MonoBehaviour
    {
        [Header("UI Panels")]
        [SerializeField] private List<UIPanel> _panels = new List<UIPanel>();
        
        [Header("Animation Settings")]
        [SerializeField] private float _fadeInDuration = 0.3f;
        [SerializeField] private float _fadeOutDuration = 0.2f;
        
        [Header("Positioning")]
        [SerializeField] private Transform _headFollowTarget;
        [SerializeField] private float _followDistance = 2f;
        [SerializeField] private float _followSmoothness = 5f;
        [SerializeField] private bool _headLocked = false;
        
        private Dictionary<string, UIPanel> _panelMap = new Dictionary<string, UIPanel>();
        private Canvas _activeCanvas;

        private void Awake()
        {
            // パネルマップを構築
            foreach (var panel in _panels)
            {
                if (!string.IsNullOrEmpty(panel.PanelId))
                {
                    _panelMap[panel.PanelId] = panel;
                }
            }
            
            // 自動検出
            if (_panels.Count == 0)
            {
                AutoDetectPanels();
            }
        }

        private void Start()
        {
            // メインカメラをフォローターゲットに
            if (_headFollowTarget == null)
            {
                var mainCam = Camera.main;
                if (mainCam != null)
                {
                    _headFollowTarget = mainCam.transform;
                }
            }
        }

        private void Update()
        {
            if (_headLocked && _headFollowTarget != null)
            {
                UpdateHeadLockedUI();
            }
        }

        private void AutoDetectPanels()
        {
            var canvases = FindObjectsOfType<Canvas>();
            foreach (var canvas in canvases)
            {
                if (canvas.renderMode == RenderMode.WorldSpace)
                {
                    var panel = canvas.GetComponent<UIPanel>();
                    if (panel == null)
                    {
                        panel = canvas.gameObject.AddComponent<UIPanel>();
                        panel.AutoSetup();
                    }
                    _panels.Add(panel);
                    
                    if (!string.IsNullOrEmpty(panel.PanelId))
                    {
                        _panelMap[panel.PanelId] = panel;
                    }
                }
            }
        }

        private void UpdateHeadLockedUI()
        {
            foreach (var panel in _panels)
            {
                if (panel.IsHeadLocked && panel.IsVisible)
                {
                    // 頭に追従
                    var targetPosition = _headFollowTarget.position + _headFollowTarget.forward * _followDistance;
                    panel.transform.position = Vector3.Lerp(
                        panel.transform.position, 
                        targetPosition, 
                        Time.deltaTime * _followSmoothness
                    );
                    
                    // カメラに向ける
                    panel.transform.rotation = Quaternion.Lerp(
                        panel.transform.rotation,
                        Quaternion.LookRotation(panel.transform.position - _headFollowTarget.position),
                        Time.deltaTime * _followSmoothness
                    );
                }
            }
        }

        /// <summary>
        /// パネルを表示
        /// </summary>
        public void ShowPanel(string panelId)
        {
            if (_panelMap.TryGetValue(panelId, out UIPanel panel))
            {
                panel.Show(_fadeInDuration);
            }
            else
            {
                Debug.LogWarning($"[Arsist UI] Panel not found: {panelId}");
            }
        }

        /// <summary>
        /// パネルを非表示
        /// </summary>
        public void HidePanel(string panelId)
        {
            if (_panelMap.TryGetValue(panelId, out UIPanel panel))
            {
                panel.Hide(_fadeOutDuration);
            }
        }

        /// <summary>
        /// パネルの表示/非表示を切り替え
        /// </summary>
        public void TogglePanel(string panelId)
        {
            if (_panelMap.TryGetValue(panelId, out UIPanel panel))
            {
                if (panel.IsVisible)
                    panel.Hide(_fadeOutDuration);
                else
                    panel.Show(_fadeInDuration);
            }
        }

        /// <summary>
        /// 全パネルを非表示
        /// </summary>
        public void HideAllPanels()
        {
            foreach (var panel in _panels)
            {
                panel.Hide(_fadeOutDuration);
            }
        }

        /// <summary>
        /// パネルを指定位置に配置
        /// </summary>
        public void PositionPanel(string panelId, Vector3 worldPosition, Quaternion rotation)
        {
            if (_panelMap.TryGetValue(panelId, out UIPanel panel))
            {
                panel.transform.position = worldPosition;
                panel.transform.rotation = rotation;
            }
        }

        /// <summary>
        /// パネルをカメラ前方に配置
        /// </summary>
        public void PositionPanelInFront(string panelId, float distance = 2f)
        {
            if (_panelMap.TryGetValue(panelId, out UIPanel panel) && _headFollowTarget != null)
            {
                var pos = _headFollowTarget.position + _headFollowTarget.forward * distance;
                panel.transform.position = pos;
                panel.transform.LookAt(_headFollowTarget);
                panel.transform.Rotate(0, 180, 0); // 正面を向ける
            }
        }

        /// <summary>
        /// パネルを取得
        /// </summary>
        public UIPanel GetPanel(string panelId)
        {
            return _panelMap.TryGetValue(panelId, out UIPanel panel) ? panel : null;
        }

        /// <summary>
        /// 新しいパネルを登録
        /// </summary>
        public void RegisterPanel(UIPanel panel)
        {
            if (!_panels.Contains(panel))
            {
                _panels.Add(panel);
                if (!string.IsNullOrEmpty(panel.PanelId))
                {
                    _panelMap[panel.PanelId] = panel;
                }
            }
        }
    }

    /// <summary>
    /// 個別のUIパネルコンポーネント
    /// </summary>
    public class UIPanel : MonoBehaviour
    {
        [SerializeField] private string _panelId;
        [SerializeField] private bool _isHeadLocked = false;
        [SerializeField] private bool _startVisible = true;
        
        private CanvasGroup _canvasGroup;
        private Canvas _canvas;
        private bool _isVisible;
        private Coroutine _animationRoutine;

        public string PanelId => _panelId;
        public bool IsHeadLocked => _isHeadLocked;
        public bool IsVisible => _isVisible;

        private void Awake()
        {
            _canvas = GetComponent<Canvas>();
            _canvasGroup = GetComponent<CanvasGroup>();
            
            if (_canvasGroup == null)
            {
                _canvasGroup = gameObject.AddComponent<CanvasGroup>();
            }
            
            _isVisible = _startVisible;
            _canvasGroup.alpha = _startVisible ? 1f : 0f;
            _canvasGroup.interactable = _startVisible;
            _canvasGroup.blocksRaycasts = _startVisible;
        }

        public void AutoSetup()
        {
            _panelId = gameObject.name;
            _canvasGroup = GetComponent<CanvasGroup>();
            if (_canvasGroup == null)
            {
                _canvasGroup = gameObject.AddComponent<CanvasGroup>();
            }

            _isVisible = true;
            _canvasGroup.alpha = 1f;
            _canvasGroup.interactable = true;
            _canvasGroup.blocksRaycasts = true;
        }

        public void Show(float duration = 0.3f)
        {
            _isVisible = true;
            _canvasGroup.interactable = true;
            _canvasGroup.blocksRaycasts = true;

            // スケールは表示開始時に少し小さくしてから戻す
            transform.localScale = Vector3.one * 0.9f;
            StartAnimation(1f, Vector3.one, duration, disableInteractionAfter: false);
        }

        public void Hide(float duration = 0.2f)
        {
            _isVisible = false;

            StartAnimation(0f, Vector3.one * 0.9f, duration, disableInteractionAfter: true);
        }

        private void StartAnimation(float targetAlpha, Vector3 targetScale, float duration, bool disableInteractionAfter)
        {
            if (_animationRoutine != null)
            {
                StopCoroutine(_animationRoutine);
                _animationRoutine = null;
            }

            _animationRoutine = StartCoroutine(AnimateRoutine(targetAlpha, targetScale, duration, disableInteractionAfter));
        }

        private IEnumerator AnimateRoutine(float targetAlpha, Vector3 targetScale, float duration, bool disableInteractionAfter)
        {
            var startAlpha = _canvasGroup.alpha;
            var startScale = transform.localScale;

            if (duration <= 0f)
            {
                _canvasGroup.alpha = targetAlpha;
                transform.localScale = targetScale;
                if (disableInteractionAfter)
                {
                    _canvasGroup.interactable = false;
                    _canvasGroup.blocksRaycasts = false;
                }
                _animationRoutine = null;
                yield break;
            }

            float t = 0f;
            while (t < 1f)
            {
                t += Time.deltaTime / duration;
                var k = Mathf.Clamp01(t);
                _canvasGroup.alpha = Mathf.Lerp(startAlpha, targetAlpha, k);
                transform.localScale = Vector3.Lerp(startScale, targetScale, k);
                yield return null;
            }

            _canvasGroup.alpha = targetAlpha;
            transform.localScale = targetScale;
            if (disableInteractionAfter)
            {
                _canvasGroup.interactable = false;
                _canvasGroup.blocksRaycasts = false;
            }

            _animationRoutine = null;
        }

        public void SetHeadLocked(bool locked)
        {
            _isHeadLocked = locked;
        }
    }
}
