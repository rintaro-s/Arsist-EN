// quest-hands: 仮想の手の表面。不透明 (深度を書く) なので、手より奥の仮想の物は隠れ、手前の物は手の上に出る。
// 光源に頼らない: 上からのやわらかい明るさ + 縁を明るく (輪郭が分かる)。Quest はシングルパス インスタンシング。
Shader "Arsist/HandSurface"
{
    Properties
    {
        _Color ("Color", Color) = (0.92, 0.94, 0.98, 1)
        _Rim ("Rim", Color) = (1, 1, 1, 1)
    }
    SubShader
    {
        Tags { "Queue" = "Geometry" "RenderType" = "Opaque" "IgnoreProjector" = "True" }
        Pass
        {
            ZWrite On
            ZTest LEqual
            Cull Back

            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "UnityCG.cginc"

            fixed4 _Color;
            fixed4 _Rim;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float3 normal : TEXCOORD0;
                float3 view : TEXCOORD1;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            v2f vert(appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_OUTPUT(v2f, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = UnityObjectToClipPos(v.vertex);
                o.normal = UnityObjectToWorldNormal(v.normal);
                o.view = normalize(WorldSpaceViewDir(v.vertex));
                return o;
            }

            fixed4 frag(v2f i) : SV_Target
            {
                float3 n = normalize(i.normal);
                float up = saturate(n.y * 0.5 + 0.5);
                float rim = pow(1.0 - saturate(dot(n, normalize(i.view))), 2.5);
                fixed3 c = _Color.rgb * (0.62 + 0.38 * up) + _Rim.rgb * rim * 0.45;
                return fixed4(c, 1);
            }
            ENDCG
        }
    }
    Fallback Off
}
