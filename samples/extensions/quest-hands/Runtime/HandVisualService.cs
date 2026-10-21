// ==============================================
// Arsist Extension: quest-hands — 手とコントローラーを空間に置く係
// samples/extensions/quest-hands/Runtime/HandVisualService.cs
//
// 位置は描く直前 (Application.onBeforeRender) に合わせる。XR Hands も XR 入力もそこで最新になるので、
// Update で合わせるより 1 フレーム遅れが少ない (手が指から遅れて付いてくるように見えない)。
// 座標はカメラの親 (トラッキング空間) で直す (quest-input と同じ)。
// ==============================================

using System.Collections.Generic;
using Arsist.Runtime.Extensions;
using UnityEngine;
using UnityEngine.XR.Hands;

namespace Arsist.Extensions.QuestHands
{
    public sealed class HandVisualService : MonoBehaviour
    {
        private const string SurfaceShader = "ArsistHandSurface";
        private const string OccluderShader = "ArsistHandOccluder";

        private ArsistExtensionContext _context;
        private Material _surface;
        private Material _occluder;
        private HandShape _leftHand, _rightHand;
        private ControllerShape _leftController, _rightController;
        private readonly List<XRHandSubsystem> _subsystems = new List<XRHandSubsystem>();
        private XRHandSubsystem _hands;
        private float _nextLookup;
        private bool _showHands = true, _showControllers = true;

        public string Look { get; private set; } = "virtual";

        public void Init(ArsistExtensionContext context)
        {
            _context = context;
            _showHands = context.GetBool("hands", true);
            _showControllers = context.GetBool("controllers", true);

            var surfaceShader = Resources.Load<Shader>(SurfaceShader);
            var occluderShader = Resources.Load<Shader>(OccluderShader);
            if (surfaceShader == null || occluderShader == null)
            {
                context.Warn($"shaders missing (Resources/{SurfaceShader}, Resources/{OccluderShader}); hands and controllers are not drawn");
                enabled = false;
                return;
            }
            _surface = new Material(surfaceShader) { name = "QuestHands Surface", enableInstancing = true };
            ApplyColor(context.GetString("handColor", "soft"));
            _occluder = new Material(occluderShader) { name = "QuestHands Occluder", enableInstancing = true };

            _leftHand = new HandShape("QuestHands Left Hand", transform, _surface);
            _rightHand = new HandShape("QuestHands Right Hand", transform, _surface);
            _leftController = new ControllerShape(true, transform, _surface);
            _rightController = new ControllerShape(false, transform, _surface);

            if (!SetLook(context.GetString("look", "virtual"))) SetLook("virtual");
            Application.onBeforeRender += OnBeforeRender;
            context.Log($"look={Look}, hands={_showHands}, controllers={_showControllers} " +
                        $"(controller models: {(_leftController.IsMetaModel && _rightController.IsMetaModel ? "Meta SDK" : "simple shapes — the build did not place the Meta models")})");
        }

        private void ApplyColor(string name)
        {
            switch (name)
            {
                case "skin":
                    _surface.SetColor("_Color", new Color(0.95f, 0.80f, 0.70f));
                    _surface.SetColor("_Rim", new Color(1f, 0.93f, 0.88f));
                    break;
                case "glass":
                    _surface.SetColor("_Color", new Color(0.55f, 0.72f, 1f));
                    _surface.SetColor("_Rim", new Color(0.85f, 0.95f, 1f));
                    break;
                default:
                    _surface.SetColor("_Color", new Color(0.92f, 0.94f, 0.98f));
                    _surface.SetColor("_Rim", Color.white);
                    break;
            }
        }

        /// <summary>見え方を変える。virtual: 形を描く / real: 深度にだけ置く (本物が見える) / off: 置かない。</summary>
        public bool SetLook(string mode)
        {
            var m = (mode ?? "").Trim().ToLowerInvariant();
            if (m != "virtual" && m != "real" && m != "off") return false;
            Look = m;
            if (_leftHand == null) return true;
            var handMaterial = m == "real" ? _occluder : _surface;
            _leftHand.SetMaterial(handMaterial);
            _rightHand.SetMaterial(handMaterial);
            // コントローラーは、仮想なら模型のマテリアルのまま、本物なら全部を深度だけに
            var controllerMaterial = m == "real" ? _occluder : null;
            _leftController.SetMaterial(controllerMaterial);
            _rightController.SetMaterial(controllerMaterial);
            return true;
        }

        public void SetParts(bool? hands, bool? controllers)
        {
            if (hands.HasValue) _showHands = hands.Value;
            if (controllers.HasValue) _showControllers = controllers.Value;
        }

        private void OnBeforeRender()
        {
            if (_leftHand == null) return;
            var cam = Camera.main;
            var space = cam != null ? cam.transform.parent : null;

            if (Look == "off" || !_showHands || !FindHands())
            {
                _leftHand.Hide();
                _rightHand.Hide();
            }
            else
            {
                _leftHand.Update(_hands.leftHand, space);
                _rightHand.Update(_hands.rightHand, space);
            }

            if (Look == "off" || !_showControllers)
            {
                _leftController.Hide();
                _rightController.Hide();
            }
            else
            {
                _leftController.Update(space);
                _rightController.Update(space);
            }
        }

        /// <summary>動いている XRHandSubsystem (1 秒に 1 回まで探す)。</summary>
        private bool FindHands()
        {
            if (_hands != null && _hands.running) return true;
            if (Time.unscaledTime < _nextLookup) return false;
            _nextLookup = Time.unscaledTime + 1f;
            _subsystems.Clear();
            SubsystemManager.GetSubsystems(_subsystems);
            foreach (var s in _subsystems)
            {
                if (s != null && s.running)
                {
                    _hands = s;
                    _context?.Log("hand tracking found");
                    return true;
                }
            }
            return false;
        }

        private void OnDestroy()
        {
            Application.onBeforeRender -= OnBeforeRender;
        }
    }
}
