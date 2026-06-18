# 검단ABA 자격시간 추적 시스템

> BCBA · QBA · QASP-S 자격 준비를 위한 시간 관리 도구

[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)

검단ABA언어행동연구소가 제작한 자격시간 추적 웹앱입니다. 필드워크·슈퍼비전 시간을 효율적으로 관리하고 자격 기준 충족도를 한눈에 확인할 수 있습니다.

🔗 **데모**: https://aba-geomdan.github.io/geomdan-tracker/

---

## ✨ 주요 기능

### 📊 대시보드
- KPI 카드 (Total Fieldwork · Direct · Indirect · Total Supervision)
- 전체 진행률 라디얼 차트
- Direct vs Indirect 비율 도넛
- 인사이트 4개 (남은 시간 · 이번 달 · 주당 페이스 · 예상 완료)
- **자격 기준 충족도** (🟢 좋음 / 🟡 더 필요 / 🔴 초과)

### 📋 필드워크 기록
- 회기별 시작/종료 시간 입력 → 자동 시간 계산
- Direct 입력 → Indirect 자동 분리
- 활동 유형 자동완성 (콤마로 여러 개 입력 가능)
- 최신순/오래된순 정렬
- Direct 초과 입력 경고

### 🎓 슈퍼비전 기록
- 그룹/개별 슈퍼비전 시간 입력
- 둘 다 입력 시 자동 경고
- 슈퍼바이저 자동 기록

### 📂 슈퍼바이저별 분석
- 자동 집계 (시간 많은 순 정렬)
- 슈퍼바이저별 누적 막대 차트

### 📈 차트
- 월별 필드워크·슈퍼비전 추이 (콤보 차트 + 누적 추세선)
- Direct·Indirect 월별 영역 차트
- 그룹·개별 슈퍼비전 월별 막대

### 💾 데이터 관리
- 브라우저 localStorage 자동 저장
- JSON 백업/복원 (수동)

---

## 🚀 시작하기

### 1. 사전 요구사항
- Node.js 18 이상
- npm 또는 yarn

### 2. 설치
```bash
git clone https://github.com/aba-geomdan/geomdan-tracker.git
cd geomdan-tracker
npm install
```

### 3. 개발 서버 실행
```bash
npm run dev
```
→ http://localhost:3000

### 4. 빌드
```bash
npm run build
```
→ `dist/` 폴더에 생성

### 5. 배포
GitHub Pages 자동 배포가 설정되어 있습니다:
- `main` 브랜치에 푸시하면 자동 배포
- 또는 수동: `npm run deploy`

---

## 🎓 시험 기준

| 시험 | Direct (최대) | Indirect (최소) | 총 필드워크 | 슈퍼비전 (그룹 최대 / 개별 최소) |
|---|---|---|---|---|
| **QBA** | 800hr | 1,200hr | 2,000hr | 100hr (50hr / 50hr) |
| **QASP-S** | 400hr | 600hr | 1,000hr | 50hr (25hr / 25hr) |

### 💡 Direct vs Indirect
- **Direct**: 현장에서 아이와 직접 만나는 시간. *최대 한도*가 있어 초과해도 더 인정 안 됨
- **Indirect**: 분석·보고서·계획 등 사무 시간. *최소 요구*량 이상 채워야 자격 인정

---

## 📁 프로젝트 구조

```
geomdan-tracker/
├── public/
│   └── favicon.svg
├── src/
│   ├── App.jsx          # 메인 컴포넌트 (전체 앱)
│   └── main.jsx         # React 엔트리
├── .github/workflows/
│   └── deploy.yml       # GitHub Pages 자동 배포
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

---

## 🛠 기술 스택

- **React 18** - UI 라이브러리
- **Vite** - 빌드 도구
- **Recharts** - 차트 라이브러리
- **localStorage** - 데이터 저장
- **GitHub Pages** - 배포

---

## 📝 라이선스

© 2026 검단ABA언어행동연구소. All Rights Reserved.

**본 자료는 검단ABA언어행동연구소의 지적재산입니다.**
- 무단 복제 · 배포 · 재판매 · 온라인 게시를 엄격히 금지합니다.
- 위반 시 저작권법에 따라 민·형사상 책임을 묻습니다.

문의: 검단ABA언어행동연구소

---

## 📞 문의 및 지원

- 버그 신고 · 기능 제안: GitHub Issues
- 일반 문의: 검단ABA언어행동연구소

---

## 🔄 버전 기록

### v1.0.0 (2026-06)
- 초기 배포
- 대시보드, 필드워크, 슈퍼비전, 슈퍼바이저별 분석 4개 탭
- JSON 백업/복원
- Recharts 시각화
