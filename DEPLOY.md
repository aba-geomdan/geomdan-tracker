# 🚀 배포 가이드

검단ABA 자격시간 추적 시스템을 GitHub Pages에 배포하는 방법입니다.

---

## 📋 사전 준비

### 필요한 것
- [x] GitHub 계정 (이미 `aba-geomdan` 계정 있음)
- [x] Node.js 18+ 설치
- [x] Git 설치
- [x] 코드 에디터 (VS Code 추천)

---

## 1️⃣ GitHub 저장소 생성

### A. GitHub 웹에서
1. https://github.com/new 접속
2. **Repository name**: `geomdan-tracker`
3. **Public** 선택 (Pages 무료 사용 위해)
4. **README, .gitignore 추가 안 함** (이미 있으니까)
5. **Create repository** 클릭

### B. 로컬에서 푸시 준비
```bash
cd geomdan-tracker  # 다운로드 받은 프로젝트 폴더
git init
git add .
git commit -m "Initial commit: 자격시간 추적 시스템 v1.0"
git branch -M main
git remote add origin https://github.com/aba-geomdan/geomdan-tracker.git
git push -u origin main
```

---

## 2️⃣ npm 의존성 설치 (로컬 테스트)

```bash
cd geomdan-tracker
npm install
```

설치되는 패키지:
- React 18
- Vite (빌드 도구)
- Recharts (차트)
- gh-pages (배포 헬퍼)

### 로컬에서 미리 확인
```bash
npm run dev
```
→ http://localhost:3000 자동 오픈

---

## 3️⃣ GitHub Pages 활성화

1. GitHub 저장소 페이지로 이동
2. **Settings** → **Pages** 클릭
3. **Source**: `GitHub Actions` 선택 (Deploy from branch ❌)
4. 저장

---

## 4️⃣ 자동 배포 확인

`main` 브랜치에 푸시하면 자동으로 배포됩니다:

```bash
git add .
git commit -m "Update"
git push
```

### 배포 진행 확인
1. 저장소 → **Actions** 탭
2. 최근 워크플로 클릭
3. `build` → `deploy` 순서로 진행 (약 1-2분)
4. 완료되면 ✅ 표시

### 사이트 접속
배포 완료 후:
**https://aba-geomdan.github.io/geomdan-tracker/**

---

## 5️⃣ 도메인 연결 (선택사항)

자체 도메인이 있다면:

1. **Settings** → **Pages** → **Custom domain**
2. 도메인 입력 (예: `tracker.geomdan-aba.com`)
3. DNS 설정에 CNAME 추가:
   ```
   tracker.geomdan-aba.com → aba-geomdan.github.io
   ```
4. **Enforce HTTPS** 체크

---

## 🔧 문제 해결

### "404 페이지" 오류
- `vite.config.js`의 `base` 경로가 저장소 이름과 일치하는지 확인
- 현재 설정: `base: '/geomdan-tracker/'`

### Actions 실패
1. **Settings** → **Actions** → **General**
2. **Workflow permissions** → "Read and write permissions" 체크
3. 저장 후 재실행

### 차트 안 보임
- 빌드 후 `dist/` 폴더에 Recharts 포함됐는지 확인
- 콘솔 에러 확인 (F12 → Console)

### 데이터가 없어짐
- 브라우저 캐시·저장소 초기화 시 발생
- 정기적으로 **💾 백업** 버튼 사용
- 다른 기기에서는 **📂 복원**으로 불러오기

---

## 📦 수동 배포 (선택사항)

자동 배포 안 쓸 경우:

```bash
# 1. 빌드
npm run build

# 2. gh-pages로 배포
npm run deploy
```

---

## 🔄 업데이트 방법

코드 수정 후:
```bash
git add .
git commit -m "기능 추가/수정 내용"
git push
```
→ 자동 빌드·배포

---

## ✅ 배포 후 체크리스트

- [ ] 사이트 정상 로딩 (https://aba-geomdan.github.io/geomdan-tracker/)
- [ ] 시험 선택 (QBA / QASP-S) 작동
- [ ] 필드워크 입력 → 자동 계산
- [ ] 슈퍼비전 입력 → 누적
- [ ] 차트 정상 표시
- [ ] 백업 · 복원 정상 작동
- [ ] 모바일에서도 잘 보임

---

## 💰 판매 전 추가 고려사항

### 도메인 (선택)
- 자체 도메인 사용 시 더 전문적
- 예: `geomdan-tracker.com`

### 결제 시스템 (별도)
- Gumroad, Lemon Squeezy 등으로 라이선스 키 판매
- 코드에 라이선스 검증 로직 추가 가능

### 사용자 분석
- Google Analytics 추가 (선택)
- index.html에 코드 삽입

### 정기 백업 안내
- 사용자에게 "월 1회 백업" 안내
- 데이터 손실 책임 면책 문구 (이미 있음)

---

문의: 검단ABA언어행동연구소
