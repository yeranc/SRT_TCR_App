sap.ui.define([
    "sap/m/MessageToast",
    "sap/ui/export/Spreadsheet",
    "sap/ui/model/json/JSONModel"
], function (MessageToast, Spreadsheet, JSONModel) {
    "use strict";

    return {
        get_results: async function () {
            const aContexts = this.extensionAPI.getSelectedContexts();

            if (!aContexts || !aContexts.length) {
                MessageToast.show("No rows selected");
                return;
            }

            this.getView().setBusy(true);

            try {
                const oModel = this.getView().getModel();
                let aResults = [];

                const aPromises = aContexts.map(function (oContext) {
                    const oData = oContext.getObject();
                    return new Promise(function (resolve) {
                        oModel.callFunction("/show_res", {
                            method: "POST",
                            urlParameters: {
                                vtgrrnr: oData.vtgrrnr,
                                Rank: oData.Rank,
                                SequenceNumber: oData.SequenceNumber
                            },
                            success: function (oResult) {
                                resolve(oResult.results || []);
                            },
                            error: function () {
                                resolve([]);
                            }
                        });
                    });
                });

                const aResponses = await Promise.all(aPromises);
                aResponses.forEach(function (aResponse) {
                    aResults.push(...aResponse);
                });

                this._showResultDialog(aResults);

            } catch (e) {
                MessageToast.show("Error fetching process logs");
                console.error(e);
            } finally {
                this.getView().setBusy(false);
            }
        },

        _showResultDialog: function (aResults) {
            const oJsonModel = new JSONModel({
                results: aResults
            });

            const oTable = new sap.m.Table({
                growing: true,
                growingThreshold: 50,
                columns: [
                    new sap.m.Column({ header: new sap.m.Text({ text: "TCR Number" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Object Type" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Source Object Number" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Process Ref ID" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Target Object Number" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Target System" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Message Type" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Message" }) })
                ]
            });

            oTable.setModel(oJsonModel);

            oTable.bindItems({
                path: "/results",
                template: new sap.m.ColumnListItem({
                    cells: [
                        new sap.m.Text({ text: "{mvtgrrnr}" }),
                        new sap.m.Text({ text: "{object_type}" }),
                        new sap.m.Text({ text: "{vtgrrnr}" }),
                        new sap.m.Text({ text: "{processingID}" }),
                        new sap.m.Text({ text: "{CreatedTCR}" }),
                        new sap.m.Text({ text: "{syst}" }),
                        new sap.m.Text({ text: "{type}" }),
                        new sap.m.Text({ text: "{message}" })
                    ]
                })
            });

            const oExportButton = new sap.m.Button({
                text: "Export",
                type: "Emphasized",
                press: function () {
                    this._exportToExcel(aResults);
                }.bind(this)
            });

            const oDialog = new sap.m.Dialog({
                title: "TCR Copy Logs",
                contentWidth: "90%",
                contentHeight: "80%",
                resizable: true,
                draggable: true,
                content: [oTable],
                buttons: [
                    oExportButton,
                    new sap.m.Button({
                        text: "Close",
                        press: function () {
                            oDialog.close();
                        }
                    })
                ],
                afterClose: function () {
                    oDialog.destroy();
                }
            });

            oDialog.open();
        },

        _exportToExcel: function (aData) {
            if (!aData || !aData.length) {
                MessageToast.show("No records to export");
                return;
            }

            const aCols = [
                { label: "TCR", property: "mvtgrrnr" },
                { label: "Process ID", property: "processingID" },
                { label: "Object Type", property: "object_type" },
                { label: "Source Number", property: "vtgrrnr" },
                { label: "Message Type", property: "type" },
                { label: "Message", property: "message" },
                { label: "Created TCR", property: "CreatedTCR" },
                { label: "System", property: "syst" }
            ];

            const oSheet = new Spreadsheet({
                workbook: {
                    columns: aCols
                },
                dataSource: aData,
                fileName: "TCR_Copy_Log.xlsx"
            });

            oSheet.build()
                .then(function () {
                    MessageToast.show("Excel downloaded successfully");
                })
                .finally(function () {
                    oSheet.destroy();
                });
        }

    };
});