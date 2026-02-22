using System;
using System.Globalization;
using Arsist.Runtime.DataFlow;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Arsist.Runtime.UI
{
    public class ArsistUIBinding : MonoBehaviour
    {
        [SerializeField] public string key;
        [SerializeField] public string format;

        private TMP_Text _tmpText;
        private Text _uiText;
        private bool _subscribed;

        private void Awake()
        {
            _tmpText = GetComponent<TMP_Text>();
            if (_tmpText == null) _tmpText = GetComponentInChildren<TMP_Text>();

            _uiText = GetComponent<Text>();
            if (_uiText == null) _uiText = GetComponentInChildren<Text>();
        }

        private void OnEnable()
        {
            TrySubscribe();
        }

        private void OnDisable()
        {
            Unsubscribe();
        }

        private void Update()
        {
            if (!_subscribed)
            {
                TrySubscribe();
            }
        }

        private void TrySubscribe()
        {
            if (_subscribed) return;
            var store = ArsistDataStore.Instance;
            if (store == null) return;

            store.OnValueChanged += OnValueChanged;
            _subscribed = true;
            UpdateFromStore();
        }

        private void Unsubscribe()
        {
            if (!_subscribed) return;
            var store = ArsistDataStore.Instance;
            if (store != null)
            {
                store.OnValueChanged -= OnValueChanged;
            }
            _subscribed = false;
        }

        private void OnValueChanged(string changedKey, object value)
        {
            if (string.IsNullOrWhiteSpace(key)) return;
            if (changedKey == key || key.StartsWith(changedKey + ".") || changedKey.StartsWith(key + "."))
            {
                UpdateFromStore();
            }
        }

        private void UpdateFromStore()
        {
            if (string.IsNullOrWhiteSpace(key)) return;
            var store = ArsistDataStore.Instance;
            if (store == null) return;
            if (!store.TryGetValueByPath(key, out var value)) return;

            var text = FormatValue(value);
            if (_tmpText != null) _tmpText.text = text;
            if (_uiText != null) _uiText.text = text;
        }

        private string FormatValue(object value)
        {
            if (value == null) return string.Empty;
            if (string.IsNullOrWhiteSpace(format)) return value.ToString();

            if (format.Contains("{value}"))
            {
                return format.Replace("{value}", value.ToString());
            }

            if (value is IFormattable formattable)
            {
                return formattable.ToString(format, CultureInfo.InvariantCulture);
            }

            return value.ToString();
        }
    }
}
