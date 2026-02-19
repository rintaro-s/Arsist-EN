using System;
using System.Collections;
using System.Collections.Generic;
using System.Data;
using System.Globalization;
using System.IO;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Text;
using System.Threading;
using Newtonsoft.Json.Linq;
using UnityEngine;
#if ARSIST_XREAL
using Unity.XR.XREAL;
#endif
#if XR_HANDS
using UnityEngine.XR.Hands;
#endif
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
using UnityEngine.Windows.Speech;
#endif

namespace Arsist.Runtime.DataFlow
{
    public class ArsistDataFlowEngine : MonoBehaviour
    {
        [SerializeField] private bool useManifestConfig = true;
        [SerializeField] private TextAsset manifestOverride;
        [SerializeField] private bool logUnsupported = true;

        private readonly List<IDataSourceRunner> _dataSources = new List<IDataSourceRunner>();
        private readonly List<TransformRunner> _transforms = new List<TransformRunner>();
        private readonly List<Coroutine> _coroutines = new List<Coroutine>();

        private readonly Dictionary<string, List<object>> _historyBuffers = new Dictionary<string, List<object>>();
        private readonly Dictionary<string, double> _accumulators = new Dictionary<string, double>();
        private readonly Dictionary<string, double> _smoothers = new Dictionary<string, double>();

        private void Awake()
        {
            DontDestroyOnLoad(gameObject);
            TryInitializeFromManifest();
        }

        private void OnDestroy()
        {
            StopAll();
        }

        private void TryInitializeFromManifest()
        {
            JObject manifest = null;

            if (useManifestConfig)
            {
                var text = Resources.Load<TextAsset>("ArsistManifest");
                if (text != null)
                {
                    try
                    {
                        manifest = JObject.Parse(text.text);
                    }
                    catch (Exception e)
                    {
                        Debug.LogWarning($"[ArsistDataFlow] Failed to parse manifest: {e.Message}");
                    }
                }
            }

            if (manifest == null && manifestOverride != null)
            {
                try
                {
                    manifest = JObject.Parse(manifestOverride.text);
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"[ArsistDataFlow] Failed to parse override manifest: {e.Message}");
                }
            }

            if (manifest == null)
            {
                Debug.LogWarning("[ArsistDataFlow] Manifest not found; data flow is disabled.");
                return;
            }

            BuildDataFlow(manifest);
        }

        private void BuildDataFlow(JObject manifest)
        {
            var dataFlow = manifest["dataFlow"] as JObject;
            if (dataFlow == null)
            {
                Debug.Log("[ArsistDataFlow] No dataFlow section found.");
                return;
            }

            var dataSources = dataFlow["dataSources"] as JArray;
            if (dataSources != null)
            {
                foreach (var token in dataSources)
                {
                    if (token is JObject obj)
                    {
                        var runner = CreateDataSourceRunner(obj);
                        if (runner != null)
                        {
                            runner.Start(this);
                            _dataSources.Add(runner);
                        }
                    }
                }
            }

            var transforms = dataFlow["transforms"] as JArray;
            if (transforms != null)
            {
                foreach (var token in transforms)
                {
                    if (token is JObject obj)
                    {
                        var runner = new TransformRunner(obj, this);
                        var coroutine = StartCoroutine(runner.Run());
                        _coroutines.Add(coroutine);
                        _transforms.Add(runner);
                    }
                }
            }

            Debug.Log($"[ArsistDataFlow] Started data sources={_dataSources.Count}, transforms={_transforms.Count}");
        }

        private void StopAll()
        {
            foreach (var source in _dataSources)
            {
                source.Stop();
            }

            foreach (var coroutine in _coroutines)
            {
                if (coroutine != null) StopCoroutine(coroutine);
            }

            _dataSources.Clear();
            _coroutines.Clear();
            _transforms.Clear();
        }

        private IDataSourceRunner CreateDataSourceRunner(JObject def)
        {
            var type = def["type"]?.ToString() ?? string.Empty;
            var mode = def["mode"]?.ToString() ?? "polling";
            var storeAs = def["storeAs"]?.ToString() ?? string.Empty;
            var updateRate = def["updateRate"]?.Value<float?>();
            var parameters = def["parameters"] as JObject;

            if (string.IsNullOrWhiteSpace(type) || string.IsNullOrWhiteSpace(storeAs))
            {
                Debug.LogWarning("[ArsistDataFlow] DataSource missing type or storeAs.");
                return null;
            }

            switch (type)
            {
                case "System_Clock":
                    return new PollingDataSourceRunner(storeAs, updateRate, () =>
                    {
                        var format = parameters?["format"]?.ToString() ?? "HH:mm:ss";
                        return DateTime.Now.ToString(format, CultureInfo.InvariantCulture);
                    });

                case "XR_Tracker":
                    return new PollingDataSourceRunner(storeAs, updateRate ?? 60f, () =>
                    {
#if ARSIST_XREAL
                        var cam = XREALUtility.MainCamera ?? Camera.main;
#else
                        var cam = Camera.main;
#endif
                        if (cam == null) return null;
                        return new Dictionary<string, object>
                        {
                            { "position", ToMap(cam.transform.position) },
                            { "rotation", ToMap(cam.transform.eulerAngles) },
                            { "forward", ToMap(cam.transform.forward) },
                        };
                    });

                case "Device_Status":
#if ARSIST_XREAL
                    return new XrealDeviceStatusDataSource(storeAs);
#else
                    return new PollingDataSourceRunner(storeAs, updateRate ?? 1f, () =>
                    {
                        return new Dictionary<string, object>
                        {
                            { "deviceModel", SystemInfo.deviceModel },
                            { "deviceName", SystemInfo.deviceName },
                            { "deviceType", SystemInfo.deviceType.ToString() },
                            { "operatingSystem", SystemInfo.operatingSystem },
                            { "batteryLevel", SystemInfo.batteryLevel },
                            { "batteryStatus", SystemInfo.batteryStatus.ToString() },
                        };
                    });
#endif

                case "XR_HandPose":
#if XR_HANDS
                    return new XRHandPoseDataSource(storeAs, updateRate ?? 30f, parameters);
#else
                    if (logUnsupported)
                    {
                        Debug.LogWarning("[ArsistDataFlow] XR_HandPose requires XR Hands package.");
                    }
                    return new PollingDataSourceRunner(storeAs, updateRate ?? 30f, () => null, true);
#endif

                case "Location_Provider":
                    return new LocationProviderDataSource(storeAs, updateRate ?? 1f, parameters);

                case "REST_Client":
                    return new RestClientDataSource(storeAs, updateRate ?? 1f, parameters);

                case "WebSocket_Stream":
                    return new WebSocketStreamDataSource(storeAs, parameters);

                case "MQTT_Subscriber":
                    return new MqttSubscriberDataSource(storeAs, parameters);

                case "Voice_Recognition":
                    return new VoiceRecognitionDataSource(storeAs, parameters);

                case "Microphone_Level":
                    return new MicrophoneLevelDataSource(storeAs, updateRate ?? 10f, parameters);

                default:
                    if (logUnsupported)
                    {
                        Debug.LogWarning($"[ArsistDataFlow] DataSource '{type}' is not supported yet.");
                    }
                    return new PollingDataSourceRunner(storeAs, updateRate ?? 1f, () => null, true);
            }
        }

        private static Dictionary<string, object> ToMap(Vector3 value)
        {
            return new Dictionary<string, object>
            {
                { "x", value.x },
                { "y", value.y },
                { "z", value.z },
            };
        }

        private static Dictionary<string, object> ToMap(Quaternion value)
        {
            return new Dictionary<string, object>
            {
                { "x", value.x },
                { "y", value.y },
                { "z", value.z },
                { "w", value.w },
            };
        }

        private static Dictionary<string, object> ToMap(Pose pose)
        {
            return new Dictionary<string, object>
            {
                { "position", ToMap(pose.position) },
                { "rotation", ToMap(pose.rotation) },
            };
        }

        private interface IDataSourceRunner
        {
            void Start(MonoBehaviour owner);
            void Stop();
        }

        private sealed class PollingDataSourceRunner : IDataSourceRunner
        {
            private readonly string _storeAs;
            private readonly float _updateRate;
            private readonly Func<object> _fetch;
            private readonly bool _quiet;
            private Coroutine _coroutine;
            private MonoBehaviour _owner;

            public PollingDataSourceRunner(string storeAs, float? updateRate, Func<object> fetch, bool quiet = false)
            {
                _storeAs = storeAs;
                _updateRate = Mathf.Max(1f, updateRate ?? 30f);
                _fetch = fetch;
                _quiet = quiet;
            }

            public void Start(MonoBehaviour owner)
            {
                _owner = owner;
                _coroutine = owner.StartCoroutine(Run());
            }

            public void Stop()
            {
                if (_coroutine != null && _owner != null)
                {
                    _owner.StopCoroutine(_coroutine);
                }
            }

            private IEnumerator Run()
            {
                var interval = 1f / _updateRate;
                var store = ArsistDataStore.Instance;
                if (!_quiet)
                {
                    Debug.Log($"[ArsistDataFlow] Polling '{_storeAs}' at {_updateRate}Hz");
                }

                while (true)
                {
                    var value = _fetch?.Invoke();
                    store.SetValue(_storeAs, value);
                    yield return new WaitForSeconds(interval);
                }
            }
        }

#if ARSIST_XREAL
        private sealed class XrealDeviceStatusDataSource : IDataSourceRunner
        {
            private readonly string _storeAs;
            private readonly Dictionary<string, object> _status = new Dictionary<string, object>();

            public XrealDeviceStatusDataSource(string storeAs)
            {
                _storeAs = storeAs;
            }

            public void Start(MonoBehaviour owner)
            {
                _status["deviceType"] = XREALPlugin.GetDeviceType().ToString();
                _status["deviceCategory"] = XREALPlugin.GetDeviceCategory().ToString();
                _status["trackingType"] = XREALPlugin.GetTrackingType().ToString();
                Push();

                XREALCallbackHandler.OnXREALGlassesBrightness += OnBrightness;
                XREALCallbackHandler.OnXREALGlassesWearingState += OnWearing;
                XREALCallbackHandler.OnXREALGlassesTemperatureLevel += OnTemperature;
                XREALCallbackHandler.OnXREALGlassesScreenStatus += OnScreen;
                XREALCallbackHandler.OnXREALGlassesRGBCameraPlugState += OnCamera;
                XREALCallbackHandler.OnXREALGlassesECLevel += OnECLevel;
                XREALCallbackHandler.OnXREALGlassesVolume += OnVolume;
                XREALCallbackHandler.OnXREALGlassesPowerSave += OnPowerSave;
            }

            public void Stop()
            {
                XREALCallbackHandler.OnXREALGlassesBrightness -= OnBrightness;
                XREALCallbackHandler.OnXREALGlassesWearingState -= OnWearing;
                XREALCallbackHandler.OnXREALGlassesTemperatureLevel -= OnTemperature;
                XREALCallbackHandler.OnXREALGlassesScreenStatus -= OnScreen;
                XREALCallbackHandler.OnXREALGlassesRGBCameraPlugState -= OnCamera;
                XREALCallbackHandler.OnXREALGlassesECLevel -= OnECLevel;
                XREALCallbackHandler.OnXREALGlassesVolume -= OnVolume;
                XREALCallbackHandler.OnXREALGlassesPowerSave -= OnPowerSave;
            }

            private void OnBrightness(uint value) { Update("brightness", value); }
            private void OnWearing(XREALWearingStatus status) { Update("wearingStatus", status.ToString()); }
            private void OnTemperature(XREALTemperatureLevel level) { Update("temperatureLevel", level.ToString()); }
            private void OnScreen(XREALDisplayState state) { Update("displayState", state.ToString()); }
            private void OnCamera(XREALRGBCameraPlugState state) { Update("rgbCamera", state.ToString()); }
            private void OnECLevel(uint value) { Update("ecLevel", value); }
            private void OnVolume(uint value) { Update("volume", value); }
            private void OnPowerSave() { Update("powerSave", true); }

            private void Update(string key, object value)
            {
                _status[key] = value;
                Push();
            }

            private void Push()
            {
                ArsistDataStore.Instance.SetValue(_storeAs, new Dictionary<string, object>(_status));
            }
        }
#endif

        private sealed class RestClientDataSource : IDataSourceRunner
        {
            private readonly string _storeAs;
            private readonly float _updateRate;
            private readonly JObject _parameters;
            private Coroutine _coroutine;
            private MonoBehaviour _owner;

            public RestClientDataSource(string storeAs, float updateRate, JObject parameters)
            {
                _storeAs = storeAs;
                _updateRate = Mathf.Max(0.1f, updateRate);
                _parameters = parameters;
            }

            public void Start(MonoBehaviour owner)
            {
                _owner = owner;
                _coroutine = owner.StartCoroutine(Run());
            }

            public void Stop()
            {
                if (_coroutine != null && _owner != null)
                {
                    _owner.StopCoroutine(_coroutine);
                }
            }

            private IEnumerator Run()
            {
                var url = _parameters?["url"]?.ToString() ?? string.Empty;
                var method = _parameters?["method"]?.ToString()?.ToUpper() ?? "GET";
                var headers = _parameters?["headers"] as JObject;
                var body = _parameters?["body"]?.ToString();
                var interval = 1f / _updateRate;
                var jsonPath = _parameters?["jsonPath"]?.ToString();

                if (string.IsNullOrWhiteSpace(url))
                {
                    Debug.LogWarning("[ArsistDataFlow] REST_Client missing URL");
                    yield break;
                }

                while (true)
                {
                    yield return StartRestRequest(url, method, headers, body, jsonPath);
                    yield return new WaitForSeconds(interval);
                }
            }

            private IEnumerator StartRestRequest(string url, string method, JObject headers, string body, string jsonPath)
            {
                using (var request = new UnityEngine.Networking.UnityWebRequest(url, method))
                {
                    if (method == "POST" && !string.IsNullOrWhiteSpace(body))
                    {
                        request.uploadHandler = new UnityEngine.Networking.UploadHandlerRaw(System.Text.Encoding.UTF8.GetBytes(body));
                    }

                    request.downloadHandler = new UnityEngine.Networking.DownloadHandlerBuffer();
                    request.SetRequestHeader("Content-Type", "application/json");

                    if (headers != null)
                    {
                        foreach (var prop in headers.Properties())
                        {
                            request.SetRequestHeader(prop.Name, prop.Value?.ToString() ?? string.Empty);
                        }
                    }

                    yield return request.SendWebRequest();

                    if (request.result == UnityEngine.Networking.UnityWebRequest.Result.Success)
                    {
                        try
                        {
                            var responseText = request.downloadHandler.text;
                            var data = JObject.Parse(responseText);

                            if (!string.IsNullOrWhiteSpace(jsonPath))
                            {
                                data = data.SelectToken(jsonPath) as JObject ?? data;
                            }

                            ArsistDataStore.Instance.SetValue(_storeAs, data.ToObject<Dictionary<string, object>>());
                        }
                        catch (System.Exception e)
                        {
                            Debug.LogWarning($"[ArsistDataFlow] REST_Client parse error: {e.Message}");
                        }
                    }
                    else
                    {
                        Debug.LogWarning($"[ArsistDataFlow] REST_Client request failed: {request.error}");
                    }
                }
            }
        }

        private sealed class WebSocketStreamDataSource : IDataSourceRunner
        {
            private readonly string _storeAs;
            private readonly JObject _parameters;
            private System.Net.WebSockets.ClientWebSocket _ws;
            private System.Threading.CancellationTokenSource _cts;
            private System.Threading.Thread _wsThread;

            public WebSocketStreamDataSource(string storeAs, JObject parameters)
            {
                _storeAs = storeAs;
                _parameters = parameters;
            }

            public void Start(MonoBehaviour owner)
            {
                _cts = new System.Threading.CancellationTokenSource();
                _wsThread = new System.Threading.Thread(() => RunWebSocket())
                {
                    IsBackground = true,
                    Name = $"WebSocket_{_storeAs}"
                };
                _wsThread.Start();
                Debug.Log($"[ArsistDataFlow] WebSocket_Stream started for {_storeAs}");
            }

            public void Stop()
            {
                _cts?.Cancel();
                _ws?.Dispose();
                if (_wsThread?.IsAlive ?? false)
                {
                    _wsThread.Join(5000);
                }
            }

            private void RunWebSocket()
            {
                var url = _parameters?["url"]?.ToString() ?? string.Empty;
                var jsonPath = _parameters?["jsonPath"]?.ToString();

                if (string.IsNullOrWhiteSpace(url))
                {
                    Debug.LogWarning("[ArsistDataFlow] WebSocket_Stream missing URL");
                    return;
                }

                try
                {
                    _ws = new System.Net.WebSockets.ClientWebSocket();
                    var uri = new System.Uri(url);
                    _ws.ConnectAsync(uri, _cts.Token).Wait(5000);

                    if (_ws.State != System.Net.WebSockets.WebSocketState.Open)
                    {
                        Debug.LogWarning($"[ArsistDataFlow] WebSocket failed to connect: {_ws.State}");
                        return;
                    }

                    Debug.Log($"[ArsistDataFlow] WebSocket connected to {url}");

                    var buffer = new byte[4096];
                    while (_ws.State == System.Net.WebSockets.WebSocketState.Open && !_cts.Token.IsCancellationRequested)
                    {
                        var result = _ws.ReceiveAsync(new System.ArraySegment<byte>(buffer), _cts.Token).Result;
                        if (result.MessageType == System.Net.WebSockets.WebSocketMessageType.Text)
                        {
                            var text = System.Text.Encoding.UTF8.GetString(buffer, 0, result.Count);
                            try
                            {
                                var data = JObject.Parse(text);
                                if (!string.IsNullOrWhiteSpace(jsonPath))
                                {
                                    data = data.SelectToken(jsonPath) as JObject ?? data;
                                }
                                ArsistDataStore.Instance.SetValue(_storeAs, data.ToObject<Dictionary<string, object>>());
                            }
                            catch { }
                        }
                        else if (result.MessageType == System.Net.WebSockets.WebSocketMessageType.Close)
                        {
                            _ws.CloseAsync(System.Net.WebSockets.WebSocketCloseStatus.NormalClosure,
                                "Closing", _cts.Token).Wait(1000);
                            break;
                        }
                    }
                }
                catch (System.Exception e)
                {
                    Debug.LogWarning($"[ArsistDataFlow] WebSocket error: {e.Message}");
                }
                finally
                {
                    _ws?.Dispose();
                }
            }
        }

        private sealed class LocationProviderDataSource : IDataSourceRunner
        {
            private readonly string _storeAs;
            private readonly float _updateRate;
            private readonly JObject _parameters;
            private Coroutine _coroutine;
            private MonoBehaviour _owner;
            private bool _useCompass;

            public LocationProviderDataSource(string storeAs, float updateRate, JObject parameters)
            {
                _storeAs = storeAs;
                _updateRate = Mathf.Max(0.1f, updateRate);
                _parameters = parameters;
            }

            public void Start(MonoBehaviour owner)
            {
                _owner = owner;
                _coroutine = owner.StartCoroutine(Run());
            }

            public void Stop()
            {
                if (_coroutine != null && _owner != null)
                {
                    _owner.StopCoroutine(_coroutine);
                }
                if (_useCompass)
                {
                    UnityEngine.Input.compass.enabled = false;
                }
                if (UnityEngine.Input.location.isEnabledByUser)
                {
                    UnityEngine.Input.location.Stop();
                }
            }

            private IEnumerator Run()
            {
                if (!UnityEngine.Input.location.isEnabledByUser)
                {
                    Debug.LogWarning("[ArsistDataFlow] Location service not enabled by user.");
                    yield break;
                }

                var desiredAccuracy = _parameters?[
                    "desiredAccuracy"
                ]?.Value<float?>() ?? 10f;
                var updateDistance = _parameters?[
                    "updateDistance"
                ]?.Value<float?>() ?? 5f;
                _useCompass = _parameters?["useCompass"]?.Value<bool?>() ?? false;

                if (_useCompass)
                {
                    UnityEngine.Input.compass.enabled = true;
                }

                UnityEngine.Input.location.Start(desiredAccuracy, updateDistance);
                var maxWait = 20;
                while (UnityEngine.Input.location.status == LocationServiceStatus.Initializing && maxWait > 0)
                {
                    yield return new WaitForSeconds(1f);
                    maxWait -= 1;
                }

                if (UnityEngine.Input.location.status != LocationServiceStatus.Running)
                {
                    Debug.LogWarning($"[ArsistDataFlow] Location service failed: {UnityEngine.Input.location.status}");
                    yield break;
                }

                var interval = 1f / _updateRate;
                while (true)
                {
                    var data = UnityEngine.Input.location.lastData;
                    var payload = new Dictionary<string, object>
                    {
                        { "latitude", data.latitude },
                        { "longitude", data.longitude },
                        { "altitude", data.altitude },
                        { "horizontalAccuracy", data.horizontalAccuracy },
                        { "verticalAccuracy", data.verticalAccuracy },
                        { "timestamp", data.timestamp },
                    };

                    if (_useCompass)
                    {
                        payload["heading"] = UnityEngine.Input.compass.trueHeading;
                        payload["magneticHeading"] = UnityEngine.Input.compass.magneticHeading;
                    }

                    ArsistDataStore.Instance.SetValue(_storeAs, payload);
                    yield return new WaitForSeconds(interval);
                }
            }
        }

        private sealed class MicrophoneLevelDataSource : IDataSourceRunner
        {
            private readonly string _storeAs;
            private readonly float _updateRate;
            private readonly JObject _parameters;
            private Coroutine _coroutine;
            private MonoBehaviour _owner;
            private string _device;
            private AudioClip _clip;
            private int _sampleWindow;
            private int _sampleRate;

            public MicrophoneLevelDataSource(string storeAs, float updateRate, JObject parameters)
            {
                _storeAs = storeAs;
                _updateRate = Mathf.Max(1f, updateRate);
                _parameters = parameters;
            }

            public void Start(MonoBehaviour owner)
            {
                _owner = owner;
                _device = _parameters?["device"]?.ToString();
                _sampleRate = _parameters?["sampleRate"]?.Value<int?>() ?? 44100;
                _sampleWindow = _parameters?["sampleWindow"]?.Value<int?>() ?? 1024;
                _clip = Microphone.Start(_device, true, 1, _sampleRate);

                if (_clip == null)
                {
                    Debug.LogWarning("[ArsistDataFlow] Microphone not available.");
                    return;
                }

                _coroutine = owner.StartCoroutine(Run());
            }

            public void Stop()
            {
                if (_coroutine != null && _owner != null)
                {
                    _owner.StopCoroutine(_coroutine);
                }
                if (!string.IsNullOrEmpty(_device) || Microphone.devices.Length > 0)
                {
                    Microphone.End(_device);
                }
            }

            private IEnumerator Run()
            {
                var interval = 1f / _updateRate;
                var samples = new float[_sampleWindow];

                while (true)
                {
                    if (_clip == null || !Microphone.IsRecording(_device))
                    {
                        yield return new WaitForSeconds(interval);
                        continue;
                    }

                    var pos = Microphone.GetPosition(_device) - _sampleWindow;
                    if (pos < 0)
                    {
                        yield return null;
                        continue;
                    }

                    _clip.GetData(samples, pos);
                    var sum = 0f;
                    for (var i = 0; i < samples.Length; i++)
                    {
                        var s = samples[i];
                        sum += s * s;
                    }
                    var rms = Mathf.Sqrt(sum / samples.Length);
                    var db = 20f * Mathf.Log10(Mathf.Max(rms, 1e-7f));

                    ArsistDataStore.Instance.SetValue(_storeAs, new Dictionary<string, object>
                    {
                        { "rms", rms },
                        { "db", db },
                    });

                    yield return new WaitForSeconds(interval);
                }
            }
        }

        private sealed class VoiceRecognitionDataSource : IDataSourceRunner
        {
            private readonly string _storeAs;
            private readonly JObject _parameters;
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
            private DictationRecognizer _dictation;
#endif

            public VoiceRecognitionDataSource(string storeAs, JObject parameters)
            {
                _storeAs = storeAs;
                _parameters = parameters;
            }

            public void Start(MonoBehaviour owner)
            {
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
                _dictation = new DictationRecognizer();
                _dictation.DictationResult += OnResult;
                _dictation.DictationError += OnError;
                _dictation.Start();
#else
                Debug.LogWarning("[ArsistDataFlow] Voice_Recognition is not supported on this platform.");
#endif
            }

            public void Stop()
            {
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
                if (_dictation != null)
                {
                    if (_dictation.Status == SpeechSystemStatus.Running)
                    {
                        _dictation.Stop();
                    }
                    _dictation.DictationResult -= OnResult;
                    _dictation.DictationError -= OnError;
                    _dictation.Dispose();
                }
#endif
            }

#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
            private void OnResult(string text, ConfidenceLevel confidence)
            {
                var payload = new Dictionary<string, object>
                {
                    { "text", text },
                    { "confidence", confidence.ToString() },
                    { "timestamp", DateTime.UtcNow.ToString("o") },
                };
                ArsistDataStore.Instance.SetValue(_storeAs, payload);
            }

            private void OnError(string error, int hresult)
            {
                Debug.LogWarning($"[ArsistDataFlow] Voice_Recognition error: {error} ({hresult})");
            }
#endif
        }

#if XR_HANDS
        private sealed class XRHandPoseDataSource : IDataSourceRunner
        {
            private readonly string _storeAs;
            private readonly float _updateRate;
            private readonly JObject _parameters;
            private Coroutine _coroutine;
            private MonoBehaviour _owner;
            private readonly List<XRHandSubsystem> _subsystems = new List<XRHandSubsystem>();

            public XRHandPoseDataSource(string storeAs, float updateRate, JObject parameters)
            {
                _storeAs = storeAs;
                _updateRate = Mathf.Max(1f, updateRate);
                _parameters = parameters;
            }

            public void Start(MonoBehaviour owner)
            {
                _owner = owner;
                _coroutine = owner.StartCoroutine(Run());
            }

            public void Stop()
            {
                if (_coroutine != null && _owner != null)
                {
                    _owner.StopCoroutine(_coroutine);
                }
            }

            private IEnumerator Run()
            {
                var interval = 1f / _updateRate;
                var joints = ParseJointList();
                var pinchThreshold = _parameters?["pinchThreshold"]?.Value<float?>() ?? 0.025f;

                while (true)
                {
                    var subsystem = GetHandSubsystem();
                    if (subsystem == null || !subsystem.running)
                    {
                        yield return new WaitForSeconds(interval);
                        continue;
                    }

                    var payload = new Dictionary<string, object>
                    {
                        { "left", BuildHandPayload(subsystem.leftHand, joints, pinchThreshold) },
                        { "right", BuildHandPayload(subsystem.rightHand, joints, pinchThreshold) },
                    };

                    ArsistDataStore.Instance.SetValue(_storeAs, payload);
                    yield return new WaitForSeconds(interval);
                }
            }

            private XRHandSubsystem GetHandSubsystem()
            {
                _subsystems.Clear();
                SubsystemManager.GetSubsystems(_subsystems);
                return _subsystems.Count > 0 ? _subsystems[0] : null;
            }

            private Dictionary<string, object> BuildHandPayload(XRHand hand, List<XRHandJointID> joints, float pinchThreshold)
            {
                var payload = new Dictionary<string, object>
                {
                    { "isTracked", hand.isTracked },
                };

                if (!hand.isTracked)
                {
                    return payload;
                }

                if (hand.GetJoint(XRHandJointID.Wrist).TryGetPose(out var rootPose))
                {
                    payload["root"] = ToMap(rootPose);
                }

                var jointMap = new Dictionary<string, object>();
                foreach (var jointId in joints)
                {
                    var joint = hand.GetJoint(jointId);
                    if (!joint.TryGetPose(out var pose)) continue;
                    jointMap[jointId.ToString()] = ToMap(pose);
                }
                payload["joints"] = jointMap;

                var pinch = ComputePinch(hand, pinchThreshold, out var pinchDistance);
                payload["pinch"] = pinch;
                payload["pinchDistance"] = pinchDistance;

                return payload;
            }

            private bool ComputePinch(XRHand hand, float threshold, out float distance)
            {
                distance = 0f;
                var thumb = hand.GetJoint(XRHandJointID.ThumbTip);
                var index = hand.GetJoint(XRHandJointID.IndexTip);
                if (!thumb.TryGetPose(out var thumbPose) || !index.TryGetPose(out var indexPose))
                {
                    return false;
                }
                distance = Vector3.Distance(thumbPose.position, indexPose.position);
                return distance <= threshold;
            }

            private List<XRHandJointID> ParseJointList()
            {
                var list = new List<XRHandJointID>();
                var joints = _parameters?["joints"] as JArray;
                if (joints == null || joints.Count == 0)
                {
                    list.Add(XRHandJointID.Wrist);
                    list.Add(XRHandJointID.Palm);
                    list.Add(XRHandJointID.ThumbTip);
                    list.Add(XRHandJointID.IndexTip);
                    list.Add(XRHandJointID.MiddleTip);
                    list.Add(XRHandJointID.RingTip);
                    list.Add(XRHandJointID.LittleTip);
                    return list;
                }

                foreach (var jointToken in joints)
                {
                    var jointName = jointToken?.ToString();
                    if (string.IsNullOrWhiteSpace(jointName)) continue;
                    if (Enum.TryParse(jointName, true, out XRHandJointID jointId))
                    {
                        list.Add(jointId);
                    }
                }

                if (list.Count == 0)
                {
                    list.Add(XRHandJointID.Wrist);
                }
                return list;
            }
        }
#endif

        private sealed class MqttSubscriberDataSource : IDataSourceRunner
        {
            private readonly string _storeAs;
            private readonly JObject _parameters;
            private Thread _thread;
            private CancellationTokenSource _cts;

            public MqttSubscriberDataSource(string storeAs, JObject parameters)
            {
                _storeAs = storeAs;
                _parameters = parameters;
            }

            public void Start(MonoBehaviour owner)
            {
                _cts = new CancellationTokenSource();
                _thread = new Thread(Run)
                {
                    IsBackground = true,
                    Name = $"MQTT_{_storeAs}",
                };
                _thread.Start();
                Debug.Log($"[ArsistDataFlow] MQTT_Subscriber started for {_storeAs}");
            }

            public void Stop()
            {
                _cts?.Cancel();
                if (_thread != null && _thread.IsAlive)
                {
                    _thread.Join(5000);
                }
            }

            private void Run()
            {
                var host = _parameters?["host"]?.ToString() ?? "";
                var port = _parameters?["port"]?.Value<int?>() ?? 1883;
                var topic = _parameters?["topic"]?.ToString() ?? "";
                var clientId = _parameters?["clientId"]?.ToString();
                var username = _parameters?["username"]?.ToString();
                var password = _parameters?["password"]?.ToString();
                var jsonPath = _parameters?["jsonPath"]?.ToString();
                var useTls = _parameters?["useTls"]?.Value<bool?>() ?? false;
                var keepAlive = _parameters?["keepAliveSeconds"]?.Value<int?>() ?? 30;
                var qos = _parameters?["qos"]?.Value<int?>() ?? 0;

                if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(topic))
                {
                    Debug.LogWarning("[ArsistDataFlow] MQTT_Subscriber requires host and topic.");
                    return;
                }

                if (string.IsNullOrWhiteSpace(clientId))
                {
                    clientId = $"arsist_{Guid.NewGuid():N}";
                }

                if (qos < 0 || qos > 2)
                {
                    qos = 0;
                }

                while (!_cts.IsCancellationRequested)
                {
                    try
                    {
                        using (var client = new TcpClient())
                        {
                            client.Connect(host, port);
                            var networkStream = client.GetStream();
                            Stream stream = networkStream;
                            if (useTls)
                            {
                                var ssl = new SslStream(stream, false, (s, cert, chain, err) => true);
                                ssl.AuthenticateAsClient(host, null, SslProtocols.Tls12, false);
                                stream = ssl;
                            }

                            stream.Write(BuildConnectPacket(clientId, username, password, keepAlive), 0,
                                BuildConnectPacket(clientId, username, password, keepAlive).Length);

                            if (!ReadConnAck(stream))
                            {
                                Debug.LogWarning("[ArsistDataFlow] MQTT connect rejected.");
                                Thread.Sleep(2000);
                                continue;
                            }

                            stream.Write(BuildSubscribePacket(topic, qos), 0, BuildSubscribePacket(topic, qos).Length);

                            var lastPing = DateTime.UtcNow;
                            while (!_cts.IsCancellationRequested)
                            {
                                if (networkStream.DataAvailable)
                                {
                                    if (!ReadPacket(stream, jsonPath))
                                    {
                                        break;
                                    }
                                }

                                if ((DateTime.UtcNow - lastPing).TotalSeconds >= keepAlive)
                                {
                                    var ping = new byte[] { 0xC0, 0x00 };
                                    stream.Write(ping, 0, ping.Length);
                                    lastPing = DateTime.UtcNow;
                                }

                                Thread.Sleep(10);
                            }
                        }
                    }
                    catch (Exception e)
                    {
                        Debug.LogWarning($"[ArsistDataFlow] MQTT error: {e.Message}");
                    }

                    Thread.Sleep(2000);
                }
            }

            private static byte[] BuildConnectPacket(string clientId, string username, string password, int keepAlive)
            {
                var payload = new List<byte>();
                payload.AddRange(EncodeString(clientId));

                var connectFlags = 0x02;
                if (!string.IsNullOrWhiteSpace(username)) connectFlags |= 0x80;
                if (!string.IsNullOrWhiteSpace(password)) connectFlags |= 0x40;

                if (!string.IsNullOrWhiteSpace(username)) payload.AddRange(EncodeString(username));
                if (!string.IsNullOrWhiteSpace(password)) payload.AddRange(EncodeString(password));

                var variable = new List<byte>();
                variable.AddRange(EncodeString("MQTT"));
                variable.Add(0x04);
                variable.Add((byte)connectFlags);
                variable.Add((byte)((keepAlive >> 8) & 0xFF));
                variable.Add((byte)(keepAlive & 0xFF));

                var packet = new List<byte>();
                packet.Add(0x10);
                packet.AddRange(EncodeRemainingLength(variable.Count + payload.Count));
                packet.AddRange(variable);
                packet.AddRange(payload);
                return packet.ToArray();
            }

            private static byte[] BuildSubscribePacket(string topic, int qos)
            {
                var payload = new List<byte>();
                payload.AddRange(EncodeString(topic));
                payload.Add((byte)qos);

                var variable = new List<byte>();
                var packetId = (ushort)UnityEngine.Random.Range(1, 65535);
                variable.Add((byte)((packetId >> 8) & 0xFF));
                variable.Add((byte)(packetId & 0xFF));

                var packet = new List<byte>();
                packet.Add(0x82);
                packet.AddRange(EncodeRemainingLength(variable.Count + payload.Count));
                packet.AddRange(variable);
                packet.AddRange(payload);
                return packet.ToArray();
            }

            private static bool ReadConnAck(Stream stream)
            {
                var fixedHeader = ReadExact(stream, 2);
                if (fixedHeader == null || fixedHeader.Length < 2) return false;
                if (fixedHeader[0] != 0x20) return false;
                var length = fixedHeader[1];
                var payload = ReadExact(stream, length);
                if (payload == null || payload.Length < 2) return false;
                return payload[1] == 0x00;
            }

            private bool ReadPacket(Stream stream, string jsonPath)
            {
                var first = stream.ReadByte();
                if (first < 0) return false;
                var remainingLength = DecodeRemainingLength(stream);
                if (remainingLength < 0) return false;
                var data = ReadExact(stream, remainingLength);
                if (data == null) return false;

                var packetType = (first & 0xF0) >> 4;
                if (packetType != 3)
                {
                    return true;
                }

                var offset = 0;
                if (data.Length < 2) return true;
                var topicLength = (data[offset] << 8) | data[offset + 1];
                offset += 2;
                if (data.Length < offset + topicLength) return true;
                var topic = Encoding.UTF8.GetString(data, offset, topicLength);
                offset += topicLength;

                var qos = (first & 0x06) >> 1;
                if (qos > 0)
                {
                    if (data.Length < offset + 2) return true;
                    offset += 2;
                }

                if (data.Length <= offset) return true;
                var payloadBytes = new byte[data.Length - offset];
                Buffer.BlockCopy(data, offset, payloadBytes, 0, payloadBytes.Length);
                var payloadText = Encoding.UTF8.GetString(payloadBytes);

                try
                {
                    var json = JObject.Parse(payloadText);
                    if (!string.IsNullOrWhiteSpace(jsonPath))
                    {
                        var token = json.SelectToken(jsonPath);
                        if (token is JObject obj)
                        {
                            ArsistDataStore.Instance.SetValue(_storeAs, obj.ToObject<Dictionary<string, object>>());
                        }
                        else
                        {
                            ArsistDataStore.Instance.SetValue(_storeAs, token?.ToString());
                        }
                    }
                    else
                    {
                        ArsistDataStore.Instance.SetValue(_storeAs, json.ToObject<Dictionary<string, object>>());
                    }
                }
                catch
                {
                    ArsistDataStore.Instance.SetValue(_storeAs, new Dictionary<string, object>
                    {
                        { "topic", topic },
                        { "payload", payloadText },
                    });
                }

                return true;
            }

            private static byte[] ReadExact(Stream stream, int length)
            {
                var buffer = new byte[length];
                var read = 0;
                while (read < length)
                {
                    var r = stream.Read(buffer, read, length - read);
                    if (r <= 0) return null;
                    read += r;
                }
                return buffer;
            }

            private static int DecodeRemainingLength(Stream stream)
            {
                var multiplier = 1;
                var value = 0;
                while (true)
                {
                    var digit = stream.ReadByte();
                    if (digit < 0) return -1;
                    value += (digit & 127) * multiplier;
                    if ((digit & 128) == 0) break;
                    multiplier *= 128;
                    if (multiplier > 128 * 128 * 128) return -1;
                }
                return value;
            }

            private static byte[] EncodeRemainingLength(int length)
            {
                var bytes = new List<byte>();
                do
                {
                    var digit = length % 128;
                    length /= 128;
                    if (length > 0) digit |= 128;
                    bytes.Add((byte)digit);
                } while (length > 0);
                return bytes.ToArray();
            }

            private static byte[] EncodeString(string value)
            {
                var bytes = Encoding.UTF8.GetBytes(value ?? string.Empty);
                var result = new byte[bytes.Length + 2];
                result[0] = (byte)((bytes.Length >> 8) & 0xFF);
                result[1] = (byte)(bytes.Length & 0xFF);
                Buffer.BlockCopy(bytes, 0, result, 2, bytes.Length);
                return result;
            }
        }

        private sealed class TransformRunner
        {
            private readonly JObject _def;
            private readonly ArsistDataFlowEngine _engine;

            public TransformRunner(JObject def, ArsistDataFlowEngine engine)
            {
                _def = def;
                _engine = engine;
            }

            public IEnumerator Run()
            {
                var storeAs = _def["storeAs"]?.ToString() ?? string.Empty;
                if (string.IsNullOrWhiteSpace(storeAs)) yield break;

                var updateRate = _def["updateRate"]?.Value<float?>() ?? 30f;
                var interval = 1f / Mathf.Max(1f, updateRate);

                while (true)
                {
                    var value = Evaluate();
                    ArsistDataStore.Instance.SetValue(storeAs, value);
                    yield return new WaitForSeconds(interval);
                }
            }

            private object Evaluate()
            {
                var type = _def["type"]?.ToString() ?? string.Empty;
                var inputs = _def["inputs"] as JArray;
                var parameters = _def["parameters"] as JObject;
                var inputValues = _engine.ResolveInputs(inputs);

                switch (type)
                {
                    case "Formula":
                        return _engine.EvalFormula(_def["expression"]?.ToString(), inputValues, inputs);
                    case "Clamper":
                        return _engine.Clamp(inputValues, parameters);
                    case "Remap":
                        return _engine.Remap(inputValues, parameters);
                    case "Smoother":
                        return _engine.Smooth(_def["id"]?.ToString(), inputValues, parameters);
                    case "Comparator":
                        return _engine.Compare(inputValues, parameters);
                    case "Threshold":
                        return _engine.Threshold(inputValues, parameters);
                    case "State_Mapper":
                        return _engine.StateMap(inputValues, parameters);
                    case "String_Template":
                        return _engine.StringTemplate(parameters, inputs, inputValues);
                    case "Time_Formatter":
                        return _engine.TimeFormat(inputValues, parameters);
                    case "History_Buffer":
                        return _engine.History(_def["id"]?.ToString(), inputValues, parameters);
                    case "Accumulator":
                        return _engine.Accumulate(_def["id"]?.ToString(), inputValues);
                    default:
                        return null;
                }
            }
        }

        private List<object> ResolveInputs(JArray inputs)
        {
            var values = new List<object>();
            if (inputs == null) return values;

            foreach (var input in inputs)
            {
                var key = input?.ToString() ?? string.Empty;
                if (string.IsNullOrWhiteSpace(key))
                {
                    values.Add(null);
                    continue;
                }

                if (ArsistDataStore.Instance.TryGetValueByPath(key, out var value))
                {
                    values.Add(value);
                }
                else
                {
                    values.Add(null);
                }
            }

            return values;
        }

        private object EvalFormula(string expression, List<object> values, JArray inputs)
        {
            if (string.IsNullOrWhiteSpace(expression)) return null;

            var table = new DataTable();
            var row = table.NewRow();

            for (var i = 0; i < values.Count; i++)
            {
                var v = ToDouble(values[i]);
                var columnName = $"v{i}";
                table.Columns.Add(columnName, typeof(double));
                row[columnName] = v;

                if (i == 0)
                {
                    if (!table.Columns.Contains("val")) table.Columns.Add("val", typeof(double));
                    row["val"] = v;
                }

                if (inputs != null && i < inputs.Count)
                {
                    var rawName = inputs[i]?.ToString() ?? string.Empty;
                    if (IsValidIdentifier(rawName) && !table.Columns.Contains(rawName))
                    {
                        table.Columns.Add(rawName, typeof(double));
                        row[rawName] = v;
                    }
                }
            }

            table.Rows.Add(row);

            try
            {
                return table.Compute(expression, string.Empty);
            }
            catch
            {
                return null;
            }
        }

        private static bool IsValidIdentifier(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return false;
            if (!char.IsLetter(name[0]) && name[0] != '_') return false;
            for (var i = 1; i < name.Length; i++)
            {
                var c = name[i];
                if (!char.IsLetterOrDigit(c) && c != '_') return false;
            }
            return true;
        }

        private object Clamp(List<object> values, JObject parameters)
        {
            var val = ToDouble(values.Count > 0 ? values[0] : null);
            var min = parameters?["min"]?.Value<double?>() ?? double.MinValue;
            var max = parameters?["max"]?.Value<double?>() ?? double.MaxValue;
            return Math.Min(Math.Max(val, min), max);
        }

        private object Remap(List<object> values, JObject parameters)
        {
            var val = ToDouble(values.Count > 0 ? values[0] : null);
            var inMin = parameters?["inMin"]?.Value<double?>() ?? 0;
            var inMax = parameters?["inMax"]?.Value<double?>() ?? 1;
            var outMin = parameters?["outMin"]?.Value<double?>() ?? 0;
            var outMax = parameters?["outMax"]?.Value<double?>() ?? 1;

            var t = Math.Abs(inMax - inMin) < 0.0001 ? 0 : (val - inMin) / (inMax - inMin);
            return outMin + (outMax - outMin) * t;
        }

        private object Smooth(string id, List<object> values, JObject parameters)
        {
            if (string.IsNullOrWhiteSpace(id)) return ToDouble(values.Count > 0 ? values[0] : null);
            var alpha = parameters?["alpha"]?.Value<double?>() ?? 0.2;
            var current = ToDouble(values.Count > 0 ? values[0] : null);

            if (!_smoothers.TryGetValue(id, out var last))
            {
                _smoothers[id] = current;
                return current;
            }

            var smoothed = last + (current - last) * alpha;
            _smoothers[id] = smoothed;
            return smoothed;
        }

        private object Compare(List<object> values, JObject parameters)
        {
            var a = ToDouble(values.Count > 0 ? values[0] : null);
            var b = ToDouble(values.Count > 1 ? values[1] : null);
            var op = parameters?["operator"]?.ToString() ?? ">";
            return op switch
            {
                ">" => a > b,
                ">=" => a >= b,
                "<" => a < b,
                "<=" => a <= b,
                "==" => Math.Abs(a - b) < 0.0001,
                "!=" => Math.Abs(a - b) >= 0.0001,
                _ => a > b,
            };
        }

        private object Threshold(List<object> values, JObject parameters)
        {
            var val = ToDouble(values.Count > 0 ? values[0] : null);
            var threshold = parameters?["threshold"]?.Value<double?>() ?? 0;
            return val >= threshold;
        }

        private object StateMap(List<object> values, JObject parameters)
        {
            var raw = values.Count > 0 ? values[0] : null;
            var key = raw?.ToString() ?? string.Empty;
            var map = parameters?["map"] as JObject;
            if (map != null && map.TryGetValue(key, StringComparison.OrdinalIgnoreCase, out var mapped))
            {
                return mapped?.ToString() ?? string.Empty;
            }
            return parameters?["default"]?.ToString() ?? key;
        }

        private object StringTemplate(JObject parameters, JArray inputs, List<object> values)
        {
            var template = parameters?["template"]?.ToString() ?? parameters?["format"]?.ToString() ?? "{value}";
            var result = template;

            if (inputs != null)
            {
                for (var i = 0; i < inputs.Count; i++)
                {
                    var key = inputs[i]?.ToString() ?? string.Empty;
                    if (string.IsNullOrWhiteSpace(key)) continue;
                    var value = values.Count > i ? values[i] : null;
                    result = result.Replace("{" + key + "}", value?.ToString() ?? string.Empty);
                }
            }

            if (values.Count > 0)
            {
                result = result.Replace("{value}", values[0]?.ToString() ?? string.Empty);
            }

            return result;
        }

        private object TimeFormat(List<object> values, JObject parameters)
        {
            var seconds = ToDouble(values.Count > 0 ? values[0] : null);
            var format = parameters?["format"]?.ToString() ?? "mm:ss";
            var span = TimeSpan.FromSeconds(seconds);

            return format switch
            {
                "HH:mm:ss" => span.ToString(@"hh\:mm\:ss"),
                "mm:ss" => span.ToString(@"mm\:ss"),
                _ => span.ToString(),
            };
        }

        private object History(string id, List<object> values, JObject parameters)
        {
            if (string.IsNullOrWhiteSpace(id)) return null;
            var size = parameters?["size"]?.Value<int?>() ?? 60;
            if (!_historyBuffers.TryGetValue(id, out var buffer))
            {
                buffer = new List<object>();
                _historyBuffers[id] = buffer;
            }

            var value = values.Count > 0 ? values[0] : null;
            buffer.Add(value);
            while (buffer.Count > size) buffer.RemoveAt(0);
            return new List<object>(buffer);
        }

        private object Accumulate(string id, List<object> values)
        {
            if (string.IsNullOrWhiteSpace(id)) return null;
            var value = ToDouble(values.Count > 0 ? values[0] : null);
            if (!_accumulators.ContainsKey(id)) _accumulators[id] = 0;
            _accumulators[id] += value;
            return _accumulators[id];
        }

        private static double ToDouble(object value)
        {
            if (value == null) return 0;
            if (value is double d) return d;
            if (value is float f) return f;
            if (value is int i) return i;
            if (value is long l) return l;
            if (value is decimal m) return (double)m;
            if (double.TryParse(value.ToString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed)) return parsed;
            return 0;
        }

    }
}
