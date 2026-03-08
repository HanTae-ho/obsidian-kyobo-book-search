/*
OUR KYOBO BOOK SEARCH - AUTHOR INTRO REMOVED VERSION (2026)
*/
const obsidian = require("obsidian");

// --- 헬퍼 함수: 제목 정제 ---
const titlePipeline = (title) => {
    if (!title) return "";
    return title.replace(/<[^>]*>?/gm, "").replace(/\(.*\)/gi, "").replace(/\[.*\]/gi, "").replace(":", "：").replace("?", "？").trim();
};

// --- HTML을 줄바꿈 유지하며 깔끔한 텍스트로 변환 ---
const extractTextWithNewlines = (el) => {
    if (!el) return "";
    let html = el.innerHTML || "";
    html = html.replace(/<br\s*[\/]?>/gi, "\n");
    html = html.replace(/<\/p>/gi, "\n");
    html = html.replace(/<\/div>/gi, "\n");
    html = html.replace(/<[^>]*>?/gm, ""); 
    html = html.replace(/&nbsp;/gi, " ");
    html = html.replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&");
    return html.replace(/\n\s*\n+/g, "\n\n").trim();
};

// --- 저자/역자 예쁘게 포맷팅하는 세탁기 함수 ---
const formatAuthorRoles = (doc) => {
    let authorText = "";
    const authorArea = doc.querySelector(".prod_author_info .author") || doc.querySelector(".author");
    
    if (authorArea) {
        let clone = authorArea.cloneNode(true);
        clone.querySelectorAll("button, .tooltip, .btn_more").forEach(el => el.remove());
        let rawText = clone.textContent.replace(/[\n\t]/g, " ").replace(/\s+/g, " ").trim();
        
        authorText = rawText
            .replace(/\s*저자\s*\([^)]*\)/g, "(저자)")
            .replace(/\s*번역\s*\([^)]*\)/g, "(번역)")
            .replace(/\s*저자\s*/g, "(저자)")
            .replace(/\s*번역\s*/g, "(번역)")
            .replace(/\s*역자\s*/g, "(번역)")
            .replace(/\s*그림\s*/g, "(그림)")
            .replace(/\s*감수\s*/g, "(감수)")
            .replace(/\s*편자\s*/g, "(편저)")
            .replace(/\s*·\s*/g, " / ")
            .replace(/\s+/g, " ");
    }
    
    if (!authorText || authorText.length < 2) {
        authorText = doc.querySelector("meta[name='author']")?.getAttribute("content")?.trim() || "저자 미상";
    }
    return authorText;
};

// --- 교보문고 상세 정보 크롤링 (노트 생성용) ---
async function getBookInfoResult(barcode, settings) {
    try {
        const response = await obsidian.requestUrl({ url: `https://product.kyobobook.co.kr/detail/${barcode}` });
        const parser = new DOMParser();
        const html = parser.parseFromString(response.text, "text/html");

        if (html.querySelector("title")?.textContent.trim() === "교보문고") {
            return { ok: false, error: "상품 페이지를 찾을 수 없습니다." };
        }

        const rawMain = html.querySelector(".prod_title")?.textContent || html.querySelector("meta[property='og:title']")?.getAttribute("content")?.replace(" - 교보문고", "");
        const mainTitle = titlePipeline(rawMain || "제목 없음");
        
        const tagArray = [settings.defaultTag].filter(Boolean);
        html.querySelectorAll(".btn_sub_depth").forEach((v) => {
            const tagText = v.textContent.replace(/(\s*)/g, "");
            if(tagText) tagArray.push(tagText);
        });
        const finalTags = [...new Set(tagArray)];

        const authorWithRole = formatAuthorRoles(html);

        let publisher = "";
        const pubEl = html.querySelector("a.btn_publish") || html.querySelector(".prod_info_text.publish_date a") || html.querySelector(".publish");
        if (pubEl) publisher = pubEl.textContent.trim();

        let publishDate = "";
        const dateEls = html.querySelectorAll(".publish_date, .date, .prod_info_text");
        for (const el of dateEls) {
            const dateMatch = el.textContent.match(/([0-9]{4})[^0-9]*([0-9]{2})[^0-9]*([0-9]{2})/);
            if (dateMatch) {
                publishDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
                break;
            }
        }

        let isbn13 = barcode; 
        let page = 0;
        html.querySelectorAll(".tbl_row tr").forEach(tr => {
            const thText = tr.querySelector("th")?.textContent || "";
            const tdText = tr.querySelector("td")?.textContent || "";
            if (thText.includes("쪽수")) page = parseInt(tdText.replace(/[^0-9]/g, '')) || 0;
            if (thText.includes("ISBN")) isbn13 = tdText.replace(/[^0-9X]/gi, '') || barcode;
        });

        let coverUrl = html.querySelector(".portrait_img")?.getAttribute("src") || html.querySelector("meta[property='og:image']")?.getAttribute("content") || "";

        // --- 책소개 / 목차 완벽 분리 추출 (저자소개 관련 부분 전면 삭제) ---
        let introText = html.querySelector("meta[property='og:description']")?.getAttribute("content") || "";
        let indexText = "";

        html.querySelectorAll(".product_detail_area, section").forEach(area => {
            const hText = area.querySelector("h3, h2, h4, .title_heading, .title")?.textContent.replace(/\s/g, "") || "";
            
            // 1. 책소개 추출
            if (hText.includes("책소개") || hText.includes("출판사서평")) {
                const textEl = area.querySelector(".intro_bottom, .info_text, .desc");
                if (textEl && textEl.textContent.length > 20) introText = extractTextWithNewlines(textEl);
            }
            
            // 2. 목차 추출
            if (hText.includes("목차")) {
                const textEl = area.querySelector(".book_contents_item, .toc_list, .info_text, .desc");
                if (textEl) indexText = extractTextWithNewlines(textEl);
            }
        });

        const frontmatter = {};
        const now = new Date();
        const kstDate = new Date(now.getTime() + 3240 * 1e4).toISOString().split("T")[0];
        if (settings.toggleCreated) frontmatter.created = `${kstDate} ${now.toTimeString().split(" ")[0].slice(0, 5)}`;
        
        frontmatter.tag = finalTags;
        frontmatter.title = mainTitle;
        frontmatter.author = authorWithRole;
        frontmatter.publisher = publisher;
        frontmatter.category = finalTags[1] || "";
        frontmatter.isbn = isbn13;
        frontmatter.total_page = page;
        frontmatter.publish_date = publishDate;
        frontmatter.cover_url = coverUrl;
        
        if (settings.toggleStatus) frontmatter.status = settings.statusSetting;
        if (settings.toggleStartReadDate) frontmatter.start_read_date = kstDate;
        if (settings.toggleFinishReadDate) frontmatter.finish_read_date = kstDate;
        if (settings.toggleMyRate) frontmatter.my_rate = +settings.myRateSetting;
        if (settings.toggleBookNote) frontmatter.book_note = settings.bookNoteSetting;

        // 본문 생성 (저자소개 부분 삭제 완료)
        const mainContent = `---
${obsidian.stringifyYaml(frontmatter)}---
${settings.toggleTitle ? `# ${mainTitle}\n` : ""}
${coverUrl ? `![|300](${coverUrl})\n` : ""}
${settings.toggleIntroduction && introText ? `## 책소개\n${introText}\n` : ""}${settings.toggleIndex && indexText ? `## 목차\n${indexText}\n` : ""}`;

        return { ok: true, book: { title: mainTitle, main: mainContent } };
    } catch (err) { return { ok: false, error: err.message }; }
}

// --- 검색 모달 ---
class BookSearchModal extends obsidian.SuggestModal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
        this.setPlaceholder("교보문고에서 책 제목을 검색하세요...");
    }
    
    async getSuggestions(query) {
        if (query.length < 2) return [];
        try {
            const res = await obsidian.requestUrl({ url: `https://search.kyobobook.co.kr/srp/api/v1/search/autocomplete/shop?keyword=${encodeURI(query)}` });
            const data = JSON.parse(res.text);
            const results = data?.data?.resultDocuments || [];
            
            const topResults = results.slice(0, 5);
            
            const enhanced = await Promise.all(topResults.map(async (item) => {
                const barcode = item.SALE_CMDTID || item.CMDTCODE;
                try {
                    const detailRes = await obsidian.requestUrl({ url: `https://product.kyobobook.co.kr/detail/${barcode}` });
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(detailRes.text, "text/html");
                    
                    const author = formatAuthorRoles(doc);

                    let publisher = "";
                    const pubEl = doc.querySelector("a.btn_publish") || doc.querySelector(".prod_info_text.publish_date a");
                    if (pubEl) publisher = pubEl.textContent.trim();
                    
                    return {
                        title: item.CMDT_NAME,
                        author: author,
                        publisher: publisher,
                        barcode: barcode
                    };
                } catch(e) {
                    return { title: item.CMDT_NAME, author: "저자 미상", publisher: "", barcode: barcode };
                }
            }));
            
            return enhanced;
        } catch (e) { return []; }
    }
    
    renderSuggestion(item, el) {
        const container = el.createDiv();
        container.createEl("div", { text: titlePipeline(item.title), style: "font-weight: bold; font-size: 1.1em;" });
        const subText = item.publisher ? `${item.author} | ${item.publisher}` : item.author;
        container.createEl("small", { text: subText, style: "color: var(--text-muted);" });
    }
    
    async onChooseSuggestion(item, evt) {
        new obsidian.Notice("도서 정보 정밀 분석 중...");
        
        const barcode = item.barcode;
        if (!barcode) return new obsidian.Notice("도서 ID를 찾을 수 없습니다.");

        const res = await getBookInfoResult(barcode, this.plugin.settings);
        
        if (!res.ok) {
            return new obsidian.Notice(`❌ 오류: ${res.error}`);
        }
        
        const fileName = res.book.title.replace(/[\\/:*?"<>|]/g, ""); 
        
        const rawPath = this.plugin.settings.saveLocation;
        let currentFolder = this.app.vault.getRoot();

        if (rawPath && rawPath.trim() !== "/" && rawPath.trim() !== "") {
            const folders = rawPath.split('/').map(f => f.trim()).filter(f => f.length > 0);
            
            for (const f of folders) {
                let found = false;
                const targetNFC = f.normalize('NFC').toLowerCase();

                for (const child of currentFolder.children) {
                    if (child instanceof obsidian.TFolder && child.name.normalize('NFC').toLowerCase() === targetNFC) {
                        currentFolder = child;
                        found = true;
                        break;
                    }
                }

                if (!found) {
                    const newPath = currentFolder.path === '/' ? f : `${currentFolder.path}/${f}`;
                    try {
                        await this.app.vault.createFolder(newPath);
                        const created = this.app.vault.getAbstractFileByPath(newPath);
                        if (created) currentFolder = created;
                    } catch (e) {
                        const existing = this.app.vault.getAbstractFileByPath(newPath);
                        if (existing) currentFolder = existing;
                    }
                }
            }
        }
        
        const filePath = currentFolder.path === '/' ? `${fileName}.md` : `${currentFolder.path}/${fileName}.md`;

        try {
            const newFile = await this.app.vault.create(filePath, res.book.main);
            const leaf = this.app.workspace.getLeaf(evt.ctrlKey || evt.metaKey);
            await leaf.openFile(newFile);
            new obsidian.Notice(`📖 교보문고 새 노트 생성 완료: ${fileName}`);
        } catch (error) {
            new obsidian.Notice("이미 동일한 제목의 노트가 있어 해당 노트를 열었습니다.");
            const existingFile = this.app.vault.getAbstractFileByPath(filePath);
            if (existingFile) this.app.workspace.getLeaf().openFile(existingFile);
        }
    }
}

// --- 플러그인 메인 ---
const DEFAULT_SETTINGS = {
    searchMode: "Modal", statusSetting: "🟢 완료", myRateSetting: "0", bookNoteSetting: "❌", defaultTag: "📚독서",
    saveLocation: "", 
    toggleTitle: true, toggleIntroduction: true, toggleIndex: true, // toggleAuthorIntro 제거됨
    toggleCreated: true, toggleStartReadDate: true, toggleFinishReadDate: true,
    toggleStatus: true, toggleMyRate: true, toggleBookNote: true
};

module.exports = class KyoboBookInfo extends obsidian.Plugin {
    async onload() {
        await this.loadSettings();
        
        this.addRibbonIcon("book-open", "Kyobo Book Search Info", () => {
            if (this.settings.searchMode === "Modal") new BookSearchModal(this.app, this).open();
            else this.addBookInfoByFilename();
        });
        
        this.addCommand({
            id: "run-kyobo-book-search", name: "Run Kyobo Book Search",
            callback: () => {
                if (this.settings.searchMode === "Modal") new BookSearchModal(this.app, this).open();
                else this.addBookInfoByFilename();
            }
        });
        this.addSettingTab(new KyoboBookInfoSettingTab(this.app, this));
    }

    async addBookInfoByFilename() {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return;
        const baseName = file.basename.trim();
        
        if (!baseName || ["무제", "Untitled", "새 파일", "Untitled 1"].includes(baseName)) {
            return new obsidian.Notice("파일명이 올바르지 않습니다.");
        }
        new obsidian.Notice("교보문고에서 파일명으로 검색 중...");
        
        try {
            const resUrl = await obsidian.requestUrl({ url: `https://search.kyobobook.co.kr/srp/api/v1/search/autocomplete/shop?keyword=${encodeURI(baseName)}` });
            const data = JSON.parse(resUrl.text);
            const results = data?.data?.resultDocuments || [];
            
            if (results.length > 0) {
                const barcode = results[0].SALE_CMDTID || results[0].CMDTCODE;
                const resInfo = await getBookInfoResult(barcode, this.settings);
                
                if (resInfo.ok) {
                    const text = await this.app.vault.read(file);
                    await this.app.vault.modify(file, resInfo.book.main + "\n\n" + text);
                    const newName = resInfo.book.title.replace(/[\\/:*?"<>|]/g, "");
                    const parentPath = file.parent.path === '/' ? '' : file.parent.path + '/';
                    await this.app.fileManager.renameFile(file, `${parentPath}${newName}.md`);
                    new obsidian.Notice("교보문고 검색 성공!");
                } else {
                    new obsidian.Notice(`❌ 오류: ${resInfo.error}`);
                }
            } else {
                new obsidian.Notice("검색 결과를 찾을 수 없습니다.");
            }
        } catch (e) {
            new obsidian.Notice("검색 중 오류가 발생했습니다.");
        }
    }
    
    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); }
};

// --- 설정 탭 ---
class KyoboBookInfoSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        
        containerEl.createEl("h2", { text: "교보문고 책 정보 검색 설정" });
        
        new obsidian.Setting(containerEl).setName("Search Mode").addDropdown(d => d
            .addOption("Filename", "파일명 기반").addOption("Modal", "검색창")
            .setValue(this.plugin.settings.searchMode).onChange(async v => { this.plugin.settings.searchMode = v; await this.plugin.saveSettings(); }));
        
        containerEl.createEl("h3", { text: "저장 경로 설정" });
        new obsidian.Setting(containerEl)
            .setName("새 노트 저장 폴더")
            .setDesc("모달 검색으로 생성되는 새 노트의 저장 위치를 지정합니다. (예: 05. 도서관/읽은 책)")
            .addText(text => text
                .setPlaceholder("경로 입력 (비워두면 최상위 폴더)")
                .setValue(this.plugin.settings.saveLocation)
                .onChange(async (value) => {
                    this.plugin.settings.saveLocation = value;
                    await this.plugin.saveSettings();
                }));

        const createToggle = (name, prop) => {
            new obsidian.Setting(containerEl).setName(name).addToggle(t => t
                .setValue(this.plugin.settings[prop]).onChange(async v => { this.plugin.settings[prop] = v; await this.plugin.saveSettings(); }));
        };
        const createInput = (name, prop) => {
            new obsidian.Setting(containerEl).setName(name).addText(t => t
                .setValue(this.plugin.settings[prop]).onChange(async v => { this.plugin.settings[prop] = v; await this.plugin.saveSettings(); }));
        };
        
        containerEl.createEl("h3", { text: "기본값 설정" });
        createInput("Default Tag", "defaultTag");
        createInput("Status Value", "statusSetting");
        createInput("My Rate Value", "myRateSetting");
        createInput("Book Note Value", "bookNoteSetting");
        
        containerEl.createEl("h3", { text: "본문 및 속성 설정" });
        createToggle("주제목 표시", "toggleTitle");
        // 저자소개 설정란 완벽 삭제 완료
        createToggle("책소개 표시", "toggleIntroduction");
        createToggle("목차 표시", "toggleIndex");
        createToggle("생성일(Created) 표시", "toggleCreated");
        createToggle("시작일(Start Read) 표시", "toggleStartReadDate");
        createToggle("종료일(Finish Read) 표시", "toggleFinishReadDate");
        createToggle("상태(Status) 표시", "toggleStatus");
        createToggle("평점(Rate) 표시", "toggleMyRate");
        createToggle("노트(Note) 표시", "toggleBookNote");
    }
}