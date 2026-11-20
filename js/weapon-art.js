// 美式漫画风武器配图生成器（厚黑描边 + 半调网点 + 赛璐璐高对比配色）
export function getWeaponArtSVG(weaponId) {
  switch (weaponId) {
    case "magnum":
      return `
        <svg viewBox="0 0 320 180" class="weapon-art-svg" aria-hidden="true">
          <defs>
            <pattern id="ht-mag" width="8" height="8" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.4" fill="rgba(16,16,22,0.16)"/>
            </pattern>
          </defs>
          <rect width="320" height="180" fill="#ff5c4d"/>
          <rect width="320" height="180" fill="url(#ht-mag)"/>
          <!-- 漫画爆炸星芒底 -->
          <polygon points="160,12 184,54 236,30 218,74 282,84 226,112 258,154 196,136 168,172 142,134 86,158 106,112 46,92 104,68 88,24 140,48"
            fill="#ffe01b" stroke="#101014" stroke-width="5" stroke-linejoin="round"/>
          <!-- 左轮枪身 -->
          <g transform="translate(22, 6) rotate(-5 160 90)">
            <!-- 枪管与顶部肋条 -->
            <rect x="132" y="54" width="128" height="22" rx="3" fill="#dce6ec" stroke="#101014" stroke-width="5"/>
            <rect x="136" y="72" width="114" height="14" rx="2" fill="#8ea2b0" stroke="#101014" stroke-width="4"/>
            <rect x="138" y="47" width="116" height="8" fill="#607482" stroke="#101014" stroke-width="4"/>
            <!-- 红点准星 -->
            <polygon points="244,47 255,47 252,36 244,39" fill="#ff2a44" stroke="#101014" stroke-width="4"/>
            <!-- 机匣 -->
            <path d="M72,54 L138,54 L138,94 L82,94 L66,76 Z" fill="#546e7a" stroke="#101014" stroke-width="5" stroke-linejoin="round"/>
            <!-- 击锤 -->
            <path d="M68,54 L56,42 L68,42 L76,54 Z" fill="#263238" stroke="#101014" stroke-width="4" stroke-linejoin="round"/>
            <!-- 金色六发弹巢 -->
            <rect x="86" y="57" width="44" height="32" rx="5" fill="#ffe01b" stroke="#101014" stroke-width="5"/>
            <line x1="92" y1="67" x2="124" y2="67" stroke="#101014" stroke-width="4" stroke-linecap="round"/>
            <line x1="92" y1="79" x2="124" y2="79" stroke="#101014" stroke-width="4" stroke-linecap="round"/>
            <!-- 扳机护圈 -->
            <ellipse cx="96" cy="104" rx="14" ry="12" fill="none" stroke="#101014" stroke-width="5"/>
            <path d="M97,94 Q102,104 94,109" fill="none" stroke="#ffe01b" stroke-width="4" stroke-linecap="round"/>
            <!-- 胡桃木握把 -->
            <path d="M72,90 L90,94 L72,146 L44,140 L58,90 Z" fill="#b85224" stroke="#101014" stroke-width="5" stroke-linejoin="round"/>
            <rect x="42" y="138" width="32" height="9" rx="2" transform="rotate(14 58 142)" fill="#ffe01b" stroke="#101014" stroke-width="4"/>
          </g>
          <g transform="translate(232, 134) rotate(-8)">
            <rect x="0" y="0" width="76" height="28" fill="#ff2a44" stroke="#101014" stroke-width="4"/>
            <text x="38" y="20" text-anchor="middle" fill="#fff" font-family="Impact, sans-serif" font-size="18" font-weight="900">BLAM!</text>
          </g>
        </svg>`;

    case "shotgun":
      return `
        <svg viewBox="0 0 320 180" class="weapon-art-svg" aria-hidden="true">
          <defs>
            <pattern id="ht-shot" width="8" height="8" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.5" fill="rgba(16,16,22,0.18)"/>
            </pattern>
          </defs>
          <rect width="320" height="180" fill="#ff7a00"/>
          <rect width="320" height="180" fill="url(#ht-shot)"/>
          <polygon points="158,10 190,48 248,26 230,72 296,86 238,116 268,158 202,140 166,174 134,136 74,158 96,112 30,90 92,64 74,20 132,44"
            fill="#ffe01b" stroke="#101014" stroke-width="5" stroke-linejoin="round"/>
          <!-- 双管泵动霰弹枪 -->
          <g transform="translate(0, 6) rotate(-7 160 90)">
            <!-- 枪托 -->
            <path d="M22,92 L92,82 L94,106 L28,132 L18,102 Z" fill="#b8541e" stroke="#101014" stroke-width="5" stroke-linejoin="round"/>
            <rect x="14" y="96" width="12" height="36" rx="2" transform="rotate(-10 20 114)" fill="#1a1a22" stroke="#101014" stroke-width="4"/>
            <!-- 双联枪管 & 散热罩 -->
            <rect x="164" y="58" width="132" height="15" rx="2" fill="#78909c" stroke="#101014" stroke-width="5"/>
            <rect x="164" y="72" width="126" height="12" rx="2" fill="#37474f" stroke="#101014" stroke-width="4"/>
            <!-- 散热孔 -->
            <rect x="180" y="61" width="10" height="6" fill="#101014"/>
            <rect x="198" y="61" width="10" height="6" fill="#101014"/>
            <rect x="216" y="61" width="10" height="6" fill="#101014"/>
            <rect x="234" y="61" width="10" height="6" fill="#101014"/>
            <!-- 黄铜准星 -->
            <circle cx="288" cy="55" r="4.5" fill="#ffe01b" stroke="#101014" stroke-width="3"/>
            <!-- 泵动木质护木 -->
            <rect x="176" y="81" width="76" height="22" rx="4" fill="#d47528" stroke="#101014" stroke-width="5"/>
            <line x1="190" y1="81" x2="190" y2="103" stroke="#101014" stroke-width="4"/>
            <line x1="206" y1="81" x2="206" y2="103" stroke="#101014" stroke-width="4"/>
            <line x1="222" y1="81" x2="222" y2="103" stroke="#101014" stroke-width="4"/>
            <line x1="238" y1="81" x2="238" y2="103" stroke="#101014" stroke-width="4"/>
            <!-- 绯红重型机匣 -->
            <rect x="86" y="58" width="90" height="36" rx="4" fill="#ff2a44" stroke="#101014" stroke-width="5"/>
            <rect x="92" y="68" width="78" height="9" fill="#ffe01b" stroke="#101014" stroke-width="3"/>
            <!-- 侧挂红壳霰弹 -->
            <rect x="100" y="79" width="12" height="22" rx="2" fill="#ff2a44" stroke="#101014" stroke-width="3"/>
            <rect x="100" y="79" width="12" height="6" fill="#ffe01b" stroke="#101014" stroke-width="2.5"/>
            <rect x="116" y="79" width="12" height="22" rx="2" fill="#ff2a44" stroke="#101014" stroke-width="3"/>
            <rect x="116" y="79" width="12" height="6" fill="#ffe01b" stroke="#101014" stroke-width="2.5"/>
            <rect x="132" y="79" width="12" height="22" rx="2" fill="#ff2a44" stroke="#101014" stroke-width="3"/>
            <rect x="132" y="79" width="12" height="6" fill="#ffe01b" stroke="#101014" stroke-width="2.5"/>
            <!-- 扳机护圈 -->
            <ellipse cx="96" cy="105" rx="13" ry="10" fill="none" stroke="#101014" stroke-width="5"/>
          </g>
          <g transform="translate(208, 134) rotate(-6)">
            <rect x="0" y="0" width="98" height="28" fill="#ff2a44" stroke="#101014" stroke-width="4"/>
            <text x="49" y="20" text-anchor="middle" fill="#fff" font-family="Impact, sans-serif" font-size="17" font-weight="900">BOOM!</text>
          </g>
        </svg>`;

    case "raygun":
      return `
        <svg viewBox="0 0 320 180" class="weapon-art-svg" aria-hidden="true">
          <defs>
            <pattern id="ht-ray" width="8" height="8" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.5" fill="rgba(255,255,255,0.16)"/>
            </pattern>
          </defs>
          <rect width="320" height="180" fill="#1e1538"/>
          <rect width="320" height="180" fill="url(#ht-ray)"/>
          <!-- 能量电光星芒 -->
          <polygon points="160,12 188,52 248,26 226,74 294,84 234,114 264,158 198,138 164,174 134,136 74,156 98,112 34,90 96,66 78,24 138,48"
            fill="#00e5ff" stroke="#101014" stroke-width="5" stroke-linejoin="round"/>
          <!-- 科幻射线枪 -->
          <g transform="translate(6, 4) rotate(-6 160 90)">
            <!-- 银色尾翼 -->
            <polygon points="78,70 144,50 138,76 74,88" fill="#e2eaf2" stroke="#101014" stroke-width="5" stroke-linejoin="round"/>
            <!-- 粉紫流线主枪身 -->
            <path d="M84,60 L238,68 L238,88 L88,104 L68,84 Z" fill="#ff2ebd" stroke="#101014" stroke-width="5" stroke-linejoin="round"/>
            <!-- 顶部青色等离子导管 -->
            <rect x="116" y="50" width="94" height="12" rx="6" fill="#00f0ff" stroke="#101014" stroke-width="4"/>
            <!-- 3 道金色能量加速环 -->
            <rect x="158" y="56" width="12" height="40" rx="5" fill="#ffe01b" stroke="#101014" stroke-width="4"/>
            <rect x="184" y="59" width="11" height="34" rx="5" fill="#ffe01b" stroke="#101014" stroke-width="4"/>
            <rect x="208" y="62" width="10" height="28" rx="4" fill="#ffe01b" stroke="#101014" stroke-width="4"/>
            <!-- 枪口发射盘与三叉天线 -->
            <polygon points="236,62 254,54 254,100 236,92" fill="#ffe01b" stroke="#101014" stroke-width="4" stroke-linejoin="round"/>
            <circle cx="258" cy="77" r="11" fill="#00f0ff" stroke="#101014" stroke-width="4"/>
            <polygon points="262,64 288,60 264,71" fill="#e2eaf2" stroke="#101014" stroke-width="3"/>
            <polygon points="262,90 288,94 264,83" fill="#e2eaf2" stroke="#101014" stroke-width="3"/>
            <!-- 能量核心球 -->
            <circle cx="102" cy="74" r="19" fill="#00f0ff" stroke="#101014" stroke-width="5"/>
            <polygon points="102,58 114,74 102,90 90,74" fill="#ffffff" stroke="#101014" stroke-width="3"/>
            <!-- 科幻握把与护圈 -->
            <path d="M84,102 L106,102 L88,150 L62,144 Z" fill="#2c2640" stroke="#101014" stroke-width="5" stroke-linejoin="round"/>
            <ellipse cx="112" cy="112" rx="12" ry="10" fill="none" stroke="#ffe01b" stroke-width="5"/>
          </g>
          <g transform="translate(222, 134) rotate(-8)">
            <rect x="0" y="0" width="84" height="28" fill="#ffe01b" stroke="#101014" stroke-width="4"/>
            <text x="42" y="20" text-anchor="middle" fill="#101014" font-family="Impact, sans-serif" font-size="18" font-weight="900">ZAP!</text>
          </g>
        </svg>`;

    case "sniper":
    default:
      return `
        <svg viewBox="0 0 320 180" class="weapon-art-svg" aria-hidden="true">
          <defs>
            <pattern id="ht-sni" width="8" height="8" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.5" fill="rgba(16,16,22,0.18)"/>
            </pattern>
          </defs>
          <rect width="320" height="180" fill="#1b4d3e"/>
          <rect width="320" height="180" fill="url(#ht-sni)"/>
          <polygon points="160,10 190,48 250,26 232,74 298,86 240,116 268,158 202,140 166,174 134,136 74,158 96,112 28,90 92,64 74,20 132,44"
            fill="#38e54d" stroke="#101014" stroke-width="5" stroke-linejoin="round"/>
          <!-- 重型栓动狙击枪 -->
          <g transform="translate(0, 6) rotate(-6 160 90)">
            <!-- 折叠两脚架 -->
            <line x1="216" y1="88" x2="236" y2="122" stroke="#101014" stroke-width="7" stroke-linecap="round"/>
            <line x1="216" y1="88" x2="236" y2="122" stroke="#546e7a" stroke-width="3" stroke-linecap="round"/>
            <!-- 超长重型枪管 + 方形制退器 -->
            <rect x="176" y="64" width="114" height="11" fill="#455a64" stroke="#101014" stroke-width="4"/>
            <rect x="282" y="58" width="24" height="22" rx="2" fill="#222831" stroke="#101014" stroke-width="5"/>
            <rect x="287" y="66" width="14" height="6" fill="#ffe01b"/>
            <!-- 战术绿枪托与贴腮垫 -->
            <path d="M18,76 L86,74 L86,98 L24,116 L14,88 Z" fill="#246b42" stroke="#101014" stroke-width="5" stroke-linejoin="round"/>
            <rect x="34" y="68" width="38" height="10" rx="3" fill="#1a1e26" stroke="#101014" stroke-width="4"/>
            <!-- 护木与黄色饰条 -->
            <rect x="148" y="72" width="76" height="20" rx="3" fill="#246b42" stroke="#101014" stroke-width="5"/>
            <rect x="154" y="79" width="64" height="6" fill="#ffe01b" stroke="#101014" stroke-width="2"/>
            <!-- 机匣 -->
            <rect x="82" y="66" width="70" height="28" rx="3" fill="#1e262e" stroke="#101014" stroke-width="5"/>
            <!-- 直插重型弹匣 -->
            <polygon points="118,94 142,94 138,136 114,134" fill="#2c3540" stroke="#101014" stroke-width="5" stroke-linejoin="round"/>
            <rect x="112" y="130" width="28" height="8" rx="2" fill="#ffe01b" stroke="#101014" stroke-width="3"/>
            <!-- 握把 -->
            <path d="M78,94 L94,94 L82,132 L64,128 Z" fill="#1e242c" stroke="#101014" stroke-width="5" stroke-linejoin="round"/>
            <!-- 镜环 + 4x高倍瞄准镜 + 翠绿物镜 -->
            <rect x="104" y="52" width="10" height="16" fill="#ffe01b" stroke="#101014" stroke-width="3"/>
            <rect x="136" y="52" width="10" height="16" fill="#ffe01b" stroke="#101014" stroke-width="3"/>
            <rect x="92" y="38" width="70" height="16" rx="4" fill="#1a1e26" stroke="#101014" stroke-width="5"/>
            <polygon points="160,36 184,31 184,59 160,54" fill="#263238" stroke="#101014" stroke-width="5" stroke-linejoin="round"/>
            <ellipse cx="90" cy="46" rx="6" ry="8" fill="#38e54d" stroke="#101014" stroke-width="3"/>
            <!-- 拉机柄 -->
            <line x1="106" y1="78" x2="106" y2="90" stroke="#cfd8dc" stroke-width="5" stroke-linecap="round"/>
            <circle cx="106" cy="92" r="5" fill="#ffe01b" stroke="#101014" stroke-width="3"/>
          </g>
          <g transform="translate(212, 134) rotate(-6)">
            <rect x="0" y="0" width="94" height="28" fill="#ffe01b" stroke="#101014" stroke-width="4"/>
            <text x="47" y="20" text-anchor="middle" fill="#101014" font-family="Impact, sans-serif" font-size="18" font-weight="900">KRAK!</text>
          </g>
        </svg>`;
  }
}
