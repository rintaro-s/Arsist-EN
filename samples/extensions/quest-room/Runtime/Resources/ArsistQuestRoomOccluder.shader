// quest-room: 本物の家具・壁の形を「深度だけ」描く (色は書かない)。
// パススルーの上では何も見えないが、その奥にある仮想の物は深度で負けて隠れる。
// Resources に置くのは、実行時に QuestRoomService が Resources.Load で引くため (ビルドに必ず入る)。
// Quest はシングルパス インスタンシングなので、ステレオのマクロを通す (片目にしか描かれない事故を防ぐ)。
Shader "Arsist/QuestRoomOccluder"
{
    SubShader
    {
        // 他の不透明な物より先に描いて、深度を置いておく
        Tags { "Queue" = "Geometry-10" "RenderType" = "Opaque" "IgnoreProjector" = "True" }
        Pass
        {
            ZWrite On
            ZTest LEqual
            ColorMask 0
            Cull Off

            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "UnityCG.cginc"

            struct appdata
            {
                float4 vertex : POSITION;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            v2f vert(appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_OUTPUT(v2f, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos = UnityObjectToClipPos(v.vertex);
                return o;
            }

            fixed4 frag(v2f i) : SV_Target
            {
                return 0;
            }
            ENDCG
        }
    }
    Fallback Off
}
