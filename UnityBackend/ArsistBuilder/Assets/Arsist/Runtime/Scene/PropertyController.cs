// ==============================================
// Arsist Engine - Property Controller (汎用制御)
// Assets/Arsist/Runtime/Scene/PropertyController.cs
// ==============================================
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Arsist.Runtime.Scene
{
    /// <summary>
    /// 任意のGameObjectの各種プロパティ（表情、ボーン回転、Transform等）を汎用的に制御する
    /// VRM、3Dオブジェクト、その他なんでも対応
    /// </summary>
    [DisallowMultipleComponent]
    public class PropertyController : MonoBehaviour
    {
        /// <summary>
        /// BlendShape（表情）制御用
        /// </summary>
        [Serializable]
        public class BlendShapeProperty
        {
            public string name;
            public SkinnedMeshRenderer renderer;
            public int blendShapeIndex = -1;
            [Range(0f, 100f)] public float weight = 0f;
            private float _targetWeight = 0f;

            public void UpdateIndex(SkinnedMeshRenderer smr)
            {
                if (smr != null && smr.sharedMesh != null)
                {
                    blendShapeIndex = smr.sharedMesh.GetBlendShapeIndex(name);
                }
            }

            public void SetWeight(float value)
            {
                _targetWeight = Mathf.Clamp(value, 0f, 100f);
            }

            public void Apply()
            {
                if (renderer == null || blendShapeIndex < 0) return;
                weight = Mathf.Lerp(weight, _targetWeight, Time.deltaTime * 10f);
                renderer.SetBlendShapeWeight(blendShapeIndex, weight);
            }
        }

        /// <summary>
        /// ボーン回転制御用
        /// ボーンの状態を管理し、アニメーション等との合成を制御
        /// </summary>
        [Serializable]
        public class BoneProperty
        {
            public string humanoidBoneName;
            public HumanBodyBones boneType;
            public Transform boneTransform;
            
            [SerializeField] private Vector3 _targetLocalRotation = Vector3.zero;
            [SerializeField] private Vector3 _currentLocalRotation = Vector3.zero;
            [SerializeField] private float _rotationSmoothTime = 0.1f;
            private Vector3 _rotationVelocity = Vector3.zero;

            public void SetTargetRotation(float pitch, float yaw, float roll)
            {
                _targetLocalRotation = new Vector3(pitch, yaw, roll);
            }

            public void RotateDelta(float deltaPitch, float deltaYaw, float deltaRoll)
            {
                _targetLocalRotation += new Vector3(deltaPitch, deltaYaw, deltaRoll);
            }

            public void Apply()
            {
                if (boneTransform == null) return;

                _currentLocalRotation = Vector3.SmoothDamp(
                    _currentLocalRotation,
                    _targetLocalRotation,
                    ref _rotationVelocity,
                    _rotationSmoothTime
                );

                boneTransform.localRotation = Quaternion.Euler(_currentLocalRotation);
            }

            public void Reset()
            {
                _targetLocalRotation = Vector3.zero;
                _currentLocalRotation = Vector3.zero;
                _rotationVelocity = Vector3.zero;
            }

            public Vector3 GetCurrentRotation()
            {
                return _currentLocalRotation;
            }
        }

        [SerializeField] private Animator _animator;
        [SerializeField] private List<BlendShapeProperty> _blendShapes = new List<BlendShapeProperty>();
        [SerializeField] private List<BoneProperty> _bones = new List<BoneProperty>();

        private Dictionary<string, BlendShapeProperty> _blendShapeMap = new Dictionary<string, BlendShapeProperty>();
        private Dictionary<string, BoneProperty> _boneMap = new Dictionary<string, BoneProperty>();

// ========================================
    // 初期化メソッド
    // ========================================

    /// <summary>
    /// PropertyControllerを初期化する
    /// VRM読込時やエディタから呼び出される
    /// </summary>
    public void Initialize(Animator animator)
    {
        if (animator == null)
        {
            Debug.LogWarning("[PropertyController] Animator is null");
            return;
        }

        _animator = animator;
        
        // BlendShape を検出
        DetectBlendShapes();
        
        // Humanoid ボーン を検出
        if (_animator.isHuman)
        {
            DetectHumanoidBones();
        }

        RebuildMaps();
        Debug.Log($"[PropertyController] Initialized: {_blendShapes.Count} expressions, {_bones.Count} bones");
    }

    private void DetectBlendShapes()
    {
        _blendShapes.Clear();
        var seenNames = new HashSet<string>();

        var skinnedMeshes = GetComponentsInChildren<SkinnedMeshRenderer>(true);
        foreach (var smr in skinnedMeshes)
        {
            if (smr == null || smr.sharedMesh == null) continue;

            int blendCount = smr.sharedMesh.blendShapeCount;
            for (int i = 0; i < blendCount; i++)
            {
                var name = smr.sharedMesh.GetBlendShapeName(i);
                if (!string.IsNullOrEmpty(name) && seenNames.Add(name))
                {
                    var bs = new BlendShapeProperty { name = name, renderer = smr };
                    bs.UpdateIndex(smr);
                    _blendShapes.Add(bs);
                }
            }
        }
    }

    private void DetectHumanoidBones()
    {
        if (_animator == null || !_animator.isHuman) return;

        _bones.Clear();

        foreach (HumanBodyBones bone in System.Enum.GetValues(typeof(HumanBodyBones)))
        {
            if (bone == HumanBodyBones.LastBone) continue;

            Transform boneTransform = _animator.GetBoneTransform(bone);
            if (boneTransform != null)
            {
                var bp = new BoneProperty
                {
                    humanoidBoneName = bone.ToString(),
                    boneType = bone,
                    boneTransform = boneTransform
                };
                _bones.Add(bp);
            }
        }
        }

        private void Awake()
    {
        // ゲーム実行時の自動初期化
        if (_animator == null)
        {
            _animator = GetComponent<Animator>();
        }
        
        if (_animator != null && _blendShapes.Count == 0 && _bones.Count == 0)
        {
            Initialize(_animator);
        }
    }

    private void LateUpdate()
        {
            // ボーン回転を適用
            foreach (var bone in _bones)
            {
                bone.Apply();
            }

            // BlendShape（表情）を適用
            foreach (var bs in _blendShapes)
            {
                bs.Apply();
            }
        }

        public void RebuildMaps()
        {
            _blendShapeMap.Clear();
            _boneMap.Clear();

            foreach (var bs in _blendShapes)
            {
                _blendShapeMap[bs.name] = bs;
            }

            foreach (var bone in _bones)
            {
                _boneMap[bone.humanoidBoneName] = bone;
            }
        }

        // ========================================
        // BlendShape (表情) 制御
        // ========================================

        public void SetBlendShapeWeight(string blendShapeName, float value)
        {
            if (_blendShapeMap.TryGetValue(blendShapeName, out var bs))
            {
                bs.SetWeight(value);
            }
            else
            {
                Debug.LogWarning($"[PropertyController] BlendShape '{blendShapeName}' not found");
            }
        }

        public float GetBlendShapeWeight(string blendShapeName)
        {
            return _blendShapeMap.TryGetValue(blendShapeName, out var bs) ? bs.weight : 0f;
        }

        public void ResetAllBlendShapes()
        {
            foreach (var bs in _blendShapes)
            {
                bs.SetWeight(0f);
            }
        }

        // ========================================
        // ボーン制御
        // ========================================

        public void SetBoneRotation(string humanoidBoneName, float pitch, float yaw, float roll)
        {
            if (_boneMap.TryGetValue(humanoidBoneName, out var bone))
            {
                bone.SetTargetRotation(pitch, yaw, roll);
            }
            else
            {
                Debug.LogWarning($"[PropertyController] Humanoid bone '{humanoidBoneName}' not found");
            }
        }

        public void RotateBoneDelta(string humanoidBoneName, float deltaPitch, float deltaYaw, float deltaRoll)
        {
            if (_boneMap.TryGetValue(humanoidBoneName, out var bone))
            {
                bone.RotateDelta(deltaPitch, deltaYaw, deltaRoll);
            }
        }

        public Vector3 GetBoneRotation(string humanoidBoneName)
        {
            return _boneMap.TryGetValue(humanoidBoneName, out var bone) ? bone.GetCurrentRotation() : Vector3.zero;
        }

        public void ResetAllBones()
        {
            foreach (var bone in _bones)
            {
                bone.Reset();
            }
        }

        // ========================================
        // メタデータ取得
        // ========================================

        public List<string> GetAllBlendShapeNames()
        {
            var result = new List<string>();
            foreach (var bs in _blendShapes)
            {
                result.Add(bs.name);
            }
            return result;
        }

        public List<string> GetAllBoneNames()
        {
            var result = new List<string>();
            foreach (var bone in _bones)
            {
                result.Add(bone.humanoidBoneName);
            }
            return result;
        }

        public bool HasHumanoid => _animator != null && _animator.isHuman;
    }
}
