// Layster.Spatial: presentation.reality = "virtual-room" の仮の部屋 (SpatialVirtualRoom) の面。
// 光を使わない単色。_GridOn = 1 なら箱のローカルの xz に、中心から _Cell (m) ごとの格子を引く (床)。
// 上を向く面ほど明るい (0.82 .. 1.0)。エディタの 3D (src/renderer/spatial/lab/VirtualRoom.tsx) と同じ見た目。
// 色は src/shared/layster/spatial/virtualRoom.ts → spatial.json の virtualRoom から来る。
Shader "Arsist/SpatialRoom"
{
    Properties
    {
        _Color ("Color", Color) = (0.14, 0.15, 0.18, 1)
        _GridColor ("Grid", Color) = (0.23, 0.25, 0.29, 1)
        _Cell ("Grid cell (m)", Float) = 0.5
        _GridOn ("Grid on", Float) = 0
        _Size ("Box size (m)", Vector) = (1, 1, 1, 0)
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
            fixed4 _GridColor;
            float _Cell;
            float _GridOn;
            float4 _Size;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 grid : TEXCOORD0;
                float shade : TEXCOORD1;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            v2f vert(appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_OUTPUT(v2f, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = UnityObjectToClipPos(v.vertex);
                // 単位の箱 (-0.5 .. 0.5) を _Size に伸ばしているので、ローカル × 大きさ = 中心からのメートル
                o.grid = v.vertex.xz * _Size.xz;
                float3 n = UnityObjectToWorldNormal(v.normal);
                o.shade = 0.82 + 0.18 * saturate(n.y * 0.5 + 0.5);
                return o;
            }

            fixed4 frag(v2f i) : SV_Target
            {
                fixed4 c = _Color * i.shade;
                if (_GridOn > 0.5)
                {
                    float2 g = i.grid / max(_Cell, 0.01);
                    float2 d = abs(frac(g - 0.5) - 0.5) / max(fwidth(g), 1e-4);
                    float l = 1.0 - saturate(min(d.x, d.y));
                    c = lerp(c, _GridColor, l);
                }
                c.a = 1;
                return c;
            }
            ENDCG
        }
    }
    Fallback Off
}
