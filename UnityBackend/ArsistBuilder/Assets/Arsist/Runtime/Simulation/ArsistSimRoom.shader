// シミュレーターが試す空間 (机・壁・床) を描くシェーダー (doc/22-simulation.md)。
// 明かりに頼らない (アプリのシーンに明かりを足さない) ように、面の向きで濃淡を付けるだけ。
// シミュレーターのビルド (Editor/Simulation/ArsistSimBuild) だけが「常に入れるシェーダー」に足す。APK には入らない。
Shader "Hidden/ArsistSim/Room"
{
    Properties
    {
        _Color ("Color", Color) = (0.6, 0.6, 0.6, 1)
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry-10" }
        Pass
        {
            Cull Back
            ZWrite On
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            fixed4 _Color;

            struct appdata { float4 vertex : POSITION; float3 normal : NORMAL; };
            struct v2f { float4 pos : SV_POSITION; float3 n : TEXCOORD0; float3 w : TEXCOORD1; };

            v2f vert (appdata v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.n = UnityObjectToWorldNormal(v.normal);
                o.w = mul(unity_ObjectToWorld, v.vertex).xyz;
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                float3 l = normalize(float3(0.35, 0.85, -0.4));
                float k = 0.62 + 0.38 * saturate(dot(normalize(i.n), l));
                // 床に 0.5 m の目地を薄く入れる (奥行きが分かるように)
                float2 g = abs(frac(i.w.xz * 2.0) - 0.5);
                float grid = (i.n.y > 0.9) ? step(0.48, max(g.x, g.y)) * 0.08 : 0;
                return fixed4(_Color.rgb * (k - grid), 1);
            }
            ENDCG
        }
    }
}
