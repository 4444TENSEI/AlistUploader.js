(function (global) {
    class AlistUploader {
        constructor(alistUploaderOptions) {
            this.baseUrl = alistUploaderOptions.baseUrl;
            this.username = alistUploaderOptions.username;
            this.password = alistUploaderOptions.password;
            this.uploadRootFolder = alistUploaderOptions.uploadRootFolder;
            this.createTimestampFolder = alistUploaderOptions.createTimestampFolder || false;
            this.debug = alistUploaderOptions.debug || false;
            this.uploadMethod = alistUploaderOptions.uploadMethod || "stream";
            this.concurrency = alistUploaderOptions.concurrency || 1;
            this.showVersionInfo = alistUploaderOptions.showVersionInfo !== undefined ? alistUploaderOptions.showVersionInfo : true;
            this.activeUploads = 0;
            this.currentXhr = null;
            this.isUploading = false;
            this.fileProgress = {};
            this.listeners = {
                progress: [],
                complete: [],
                error: [],
            };

            if (this.showVersionInfo) {
                AlistUploader.printVersionInfo();
            }
            if (this.debug) {
                this.printConfigInfo();
            }
        }

        static debugLog(debug, ...msgs) {
            if (debug) {
                console.log(...msgs);
            }
        }

        printVersion() {
            if (this.showVersionInfo) {
                AlistUploader.printVersionInfo();
            }
        }

        static printVersionInfo() {
            console.log('%cAlistUploaderJS v0.1.2', `
                color: white;
                background: linear-gradient(to right, rgb(120,120,220) 20%, rgb(160,200,240) 80%);
                padding: 6px;
                border: 3px solid rgb(160,200,240);
                border-radius: 6px;
                display: block;
            `, ' - GitHub: https://github.com/4444TENSEI/AlistUploaderJS');
        }

        // 打印配置信息
        printConfigInfo() {
            const configInfo = {
                '账号': this.username,
                '密码': '******',
                '服务地址': this.baseUrl,
                '上传根目录': this.uploadRootFolder || '未指定',
                '并发上传数量': this.concurrency || 1,
                '创建时间戳文件夹': this.createTimestampFolder || false,
                '调试模式': this.debug || false,
                '显示版本信息': this.showVersionInfo !== undefined ? this.showVersionInfo : true,
                '上传方式': this.uploadMethod || 'stream'
            };
            console.log('AlistUploaderJS配置信息载入成功：', configInfo);
        }

        // 添加事件监听器
        on(event, listener) {
            if (this.listeners[event]) {
                this.listeners[event].push(listener);
            }
        }

        // 移除事件监听器
        off(event, listener) {
            if (this.listeners[event]) {
                this.listeners[event] = this.listeners[event].filter(
                    (l) => l !== listener
                );
            }
        }

        // 触发事件
        trigger(event, ...args) {
            if (this.listeners[event]) {
                this.listeners[event].forEach((listener) => listener(...args));
            }
        }

        // 取消上传
        abortUpload() {
            if (this.currentXhr) {
                this.currentXhr.abort();
                this.currentXhr = null;
                this.isUploading = false;
                AlistUploader.debugLog(this.debug, "取消上传。");
            } else {
                console.log("当前没有正在上传的任务。");
            }
        }

        // 监听文件上传进度
        uploadProgressListener(debug, event, file) {
            if (event.lengthComputable && debug) {
                const now = Date.now();
                const loaded = event.loaded;
                const total = event.total;
                const percentComplete = (loaded / total) * 100;
                const fileSize = file.size < 1024 * 1024
                    ? `${(file.size / 1024).toFixed(2)} KB`
                    : `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
                this.fileProgress[file.name] = this.fileProgress[file.name] || {
                    startTime: now,
                    lastLoaded: 0,
                    movingAverageSpeed: 0,
                    progress: 0,
                    fileSize: fileSize,
                };
                const progressInfo = this.fileProgress[file.name];
                const timeDiff = (now - progressInfo.lastTime) / 1000;
                const bytesDiff = loaded - progressInfo.lastLoaded;
                const newSpeed = bytesDiff / (timeDiff || 1);
                progressInfo.movingAverageSpeed = progressInfo.movingAverageSpeed * 0.8 + newSpeed * 0.2;
                const remainingBytes = total - loaded;
                const remainingTime = remainingBytes / (progressInfo.movingAverageSpeed || 1);
                let uploadSpeed;
                if (progressInfo.movingAverageSpeed >= 1024 * 1024 * 1024) {
                    uploadSpeed = `${(progressInfo.movingAverageSpeed / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
                } else if (progressInfo.movingAverageSpeed >= 1024 * 1024) {
                    uploadSpeed = `${(progressInfo.movingAverageSpeed / (1024 * 1024)).toFixed(2)} MB/s`;
                } else if (progressInfo.movingAverageSpeed >= 1024) {
                    uploadSpeed = `${(progressInfo.movingAverageSpeed / 1024).toFixed(2)} KB/s`;
                } else {
                    uploadSpeed = `${progressInfo.movingAverageSpeed.toFixed(2)} B/s`;
                }
                progressInfo.progress = percentComplete;
                progressInfo.progressText = percentComplete.toFixed(2) + "%";
                progressInfo.remainingTime = Math.ceil(remainingTime);
                progressInfo.timeDiff = Math.ceil((now - progressInfo.startTime) / 1000);
                progressInfo.lastLoaded = loaded;
                progressInfo.lastTime = now;
                progressInfo.uploadSpeed = uploadSpeed;
                console.log({
                    file: file.name,
                    progress: progressInfo.progressText,
                    fileSize: progressInfo.fileSize,
                    movingAverageSpeed: uploadSpeed,
                    remainingTime: `${progressInfo.remainingTime} 秒`,
                    timeDiff: `${progressInfo.timeDiff} 秒`,
                });
                this.trigger("progress", this.fileProgress);
            }
        }


        // 登录到Alist服务
        async login() {
            const response = await fetch(`${this.baseUrl}/api/auth/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    Username: this.username,
                    Password: this.password,
                }),
            });
            const data = await response.json();
            AlistUploader.debugLog(this.debug, "登录响应:", data);
            if (data.code !== 200) {
                throw new Error("登录出错: " + data.message);
            }
            const token = data.data.token;
            await this.getDirectoryInfo(token);
            return token;
        }

        // 获取所有目录
        async getDirectoryInfo(token) {
            const response = await fetch(`${this.baseUrl}/api/fs/list`, {
                method: "POST",
                headers: {
                    Authorization: token,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ path: this.uploadRootFolder }),
            });
            const data = await response.json();
            AlistUploader.debugLog(this.debug, "获取根目录列表:", data);
            if (data.code !== 200) {
                throw new Error("获取目录信息出错: " + data.message);
            }
        }

        // 创建文件夹目录
        async createFolder(token) {
            let folderPath = this.uploadRootFolder;
            if (this.createTimestampFolder) {
                const folderName = new Date()
                    .toISOString()
                    .replace(/[-:.TZ]/g, "")
                    .substring(0, 14);
                folderPath = `${this.uploadRootFolder}/${folderName}`;
                const response = await fetch(`${this.baseUrl}/api/fs/mkdir`, {
                    method: "POST",
                    headers: {
                        Authorization: token,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ path: folderPath }),
                });
                const data = await response.json();
                AlistUploader.debugLog(
                    this.debug,
                    "温馨提示: 由于createTimestampFolder开启, 上传前自动创建文件夹:",
                    folderName
                );
                if (data.code !== 200) {
                    throw new Error("本次上传自动创建文件夹出错: " + data.message);
                }
            } else {
                AlistUploader.debugLog(
                    this.debug,
                    "提示: createTimestampFolder未开启, 将直接上传到根目录:",
                    folderPath
                );
            }
            return folderPath;
        }

        // 单文件处理
        async uploadFile(token, folderPath, file) {
            if (this.uploadMethod === "form") {
                return this.formUploadFile(token, folderPath, file);
            } else if (this.uploadMethod === "stream") {
                return this.streamUploadFile(token, folderPath, file);
            } else {
                throw new Error("未知的上传方式: " + this.uploadMethod);
            }
        }

        // 多文件处理
        async uploadFiles(files) {
            if (this.isUploading) {
                console.warn("上传正在进行中，请稍后再试。");
                return Promise.resolve();
            }
            this.isUploading = true;
            try {
                if (files.length === 0) {
                    return;
                }
                const token = await this.login();
                const folderPath = await this.createFolder(token);
                let allSuccess = true;
                const uploadPromises = Array.from(files).map((file) => {
                    return new Promise(async (resolve) => {
                        while (this.activeUploads >= this.concurrency) {
                            await new Promise((resolve) => setTimeout(resolve, 100));
                        }
                        this.activeUploads++;
                        try {
                            const result = await this.uploadFile(token, folderPath, file);
                            allSuccess = allSuccess && result.success;
                            resolve(result);
                        } catch (error) {
                            this.trigger("error", error);
                            resolve({ success: false, file: file.name });
                        } finally {
                            this.activeUploads--;
                        }
                    });
                });
                await Promise.all(uploadPromises);
                if (allSuccess) {
                    AlistUploader.debugLog(this.debug, "所有文件上传成功。");
                } else {
                    AlistUploader.debugLog(this.debug, "部分文件上传失败。");
                }
                this.trigger("complete", allSuccess);
                return folderPath;
            } finally {
                this.isUploading = false;
            }
        }

        // 辅助方法：对路径编码
        encodePath(path) {
            return path.split('/').map(encodeURIComponent).join('/');
        }

        // 使用表单上传文件
        async formUploadFile(token, folderPath, file) {
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                this.currentXhr = xhr;
                const formData = new FormData();
                formData.append("file", file);
                xhr.open("PUT", `${this.baseUrl}/api/fs/form`, true);
                xhr.setRequestHeader("Authorization", token);
                const fullPath = this.encodePath(`${folderPath}/${file.name}`);
                xhr.setRequestHeader("File-Path", fullPath);
                xhr.setRequestHeader("As-Task", "true");
                xhr.upload.onprogress = (event) =>
                    this.uploadProgressListener(this.debug, event, file);
                xhr.onload = () => {
                    if (xhr.status === 200) {
                        AlistUploader.debugLog(
                            this.debug,
                            `√上传成功: "${encodeURIComponent(file.name)}", 查看${this.baseUrl
                            }/${folderPath}/${encodeURIComponent(file.name)}`
                        );
                        resolve({ success: true, file: file.name });
                    } else {
                        this.trigger("error", new Error(`上传出错: ${xhr.statusText}`));
                        resolve({ success: false, file: file.name });
                    }
                };
                xhr.onerror = () =>
                    this.trigger("error", new Error("网络错误或服务器无响应"));
                xhr.send(formData);
            });
        }

        // 使用流上传文件
        async streamUploadFile(token, folderPath, file) {
            const url = `${this.baseUrl}/api/fs/put`;
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                const filePath = this.encodePath(`${folderPath}/${file.name}`);
                this.currentXhr = xhr;
                xhr.open("PUT", url);
                xhr.setRequestHeader("Authorization", token);
                xhr.setRequestHeader("File-Path", filePath);
                xhr.setRequestHeader("Content-Type", "application/octet-stream");
                xhr.upload.onprogress = (event) =>
                    this.uploadProgressListener(this.debug, event, file);
                xhr.onload = () => {
                    if (xhr.status === 200) {
                        AlistUploader.debugLog(
                            this.debug,
                            `√上传成功, 上传至: "${this.baseUrl}/${filePath}"`
                        );
                        resolve({ success: true, file: file.name });
                    } else {
                        this.trigger("error", new Error(`上传出错: ${xhr.statusText}`));
                        resolve({ success: false, file: file.name });
                    }
                };
                xhr.onerror = () =>
                    this.trigger("error", new Error("网络错误或服务器无响应"));
                xhr.ontimeout = () => reject(new Error("请求超时"));
                const reader = new FileReader();
                reader.onload = (e) => {
                    const arrayBuffer = e.target.result;
                    xhr.send(new Blob([arrayBuffer]));
                };
                reader.onerror = () => this.trigger("error", new Error("读取文件出错"));
                reader.readAsArrayBuffer(file);
            });
        }
    }

    global.AlistUploader = AlistUploader;
})(window);
